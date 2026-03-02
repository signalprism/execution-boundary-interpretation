
// Deterministic gate runner (Run 2) — refactored for clean seams:
// intent -> diff summary -> changed files -> mutation eval -> policy eval -> meaning artifact output

const { loadAuthority } = require("./config/loadAuthority"); // adjust path if gate-run4.js sits in src/
const fs = require("fs");
const path = require("path");

// Existing diff summary (you already have this)
const { computeDiffSummary } = require("./diff"); // :contentReference[oaicite:2]{index=2}

// Optional: if you add getChangedFilesWithDiff to diff.js as discussed, import it here.
// If you haven't added it yet, this file will still work using a minimal changedFiles adapter.
let getChangedFilesWithDiff = null;
try {
  // eslint-disable-next-line global-require
  ({ getChangedFilesWithDiff } = require("./diff"));
} catch {
  // ok: fall back to minimal adapter
}

// --- Small IO helpers --------------------------------------------------------

function readTextOrNull(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readJsonOrThrow(p) {
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${p}: ${e.message}`);
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

// --- Intent normalization -----------------------------------------------------
// Supports both styles you’ve used:
// A) { mode, intent, declared_authority } :contentReference[oaicite:3]{index=3}
// B) { agent, scope, mutation_class, max_files, allow_* } :contentReference[oaicite:4]{index=4}
//
// Output: canonical intent object used by the gate.

function normalizeIntent(intentRaw) {
  // Style A
  if (intentRaw && typeof intentRaw === "object" && intentRaw.declared_authority) {
    return {
      intent_mode: intentRaw.mode || "normal",
      intent_text: intentRaw.intent || "",
      declared_authority: String(intentRaw.declared_authority),
      // keep original for inclusion in meaning artifact
      raw: intentRaw,
    };
  }

  // Style B (agent-style)
  if (intentRaw && typeof intentRaw === "object" && intentRaw.mutation_class) {
    // Deterministic mapping: mutation_class -> declared_authority
    // Keep conservative defaults; adjust later when you canon-lock.
    const mc = String(intentRaw.mutation_class).toLowerCase();
    const map = {
      patch: "medium",
      minor: "high",
      major: "critical",
    };

    return {
      intent_mode: "agent",
      intent_text: `agent=${intentRaw.agent || "unknown"} mutation_class=${mc}`,
      declared_authority: map[mc] || "medium",
      raw: intentRaw,
    };
  }

  // Fallback (still deterministic)
  return {
    intent_mode: "unknown",
    intent_text: "",
    declared_authority: "low",
    raw: intentRaw,
  };
}

// --- Mutation evaluation (catalog-driven) ------------------------------------
// This version can run with or without external modules.
// If you later split into ./mutation/* modules, keep the same interface.

function loadMutationCatalog(catalogPath) {
  const raw = fs.readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw);

  if (catalog.schema !== "sp.ebi.mutation_class_catalog.v1") {
    throw new Error(`Invalid mutation catalog schema: ${catalog.schema}`);
  }
  if (!Array.isArray(catalog.classes)) {
    throw new Error("Invalid mutation catalog: missing classes[]");
  }
  return catalog;
}

// Minimal deterministic matchers (path_glob + content_regex)
// If you add more matcher types later, extend this switch.
const { minimatch }  = require("minimatch");

function matchPathGlob(filePath, matcher) {
  const include = matcher.include || [];
  const exclude = matcher.exclude || [];
  const included = include.some((g) => minimatch(filePath, g, { dot: true }));
  const excluded = exclude.some((g) => minimatch(filePath, g, { dot: true }));
  return included && !excluded;
}

function matchContentRegex(diffText, matcher) {
  const re = new RegExp(matcher.pattern);
  return re.test(diffText || "");
}

function inferDominantActionClassFromMutations(mutations) {
  if (!mutations || mutations.length === 0) return "no_change";

  // priority order (highest gravity first)
  const priority = [
    { prefix: "secret.", action: "secret_material" },
    { prefix: "ci.", action: "workflow_change" },
    { prefix: "dependency.", action: "dependency_change" },
    { prefix: "build.", action: "code_change" },
    { prefix: "runtime.", action: "code_change" },
    { prefix: "access.", action: "code_change" },
    { prefix: "network.", action: "code_change" }
  ];

  // if any mutation matches a higher-priority prefix, select it
  for (const p of priority) {
    if (mutations.some(m => String(m.mutation_class_id || "").startsWith(p.prefix))) {
      return p.action;
    }
  }

  // fallback
  return "code_change";
}

const yaml = require("js-yaml");

function lookupRequiredAuthority(actionClass, registryYamlText) {
  // Safe defaults
  const fallback = "low";
  if (!registryYamlText) return fallback;

  let registry;
  try {
    registry = yaml.load(registryYamlText);
  } catch {
    return fallback;
  }

  const ac = registry?.action_classes?.[actionClass];
  if (!ac) return fallback;

  return ac.min_authority || fallback;
}

function evaluateMutations({ changedFiles, catalog }) {
  const findings = [];

  for (const file of changedFiles) {
    const filePath = file.filePath;
    const diffText = file.diffText || "";

    for (const cls of catalog.classes) {
      let matched = false;
      const ruleIds = [];

      for (const matcher of (cls.matchers || [])) {
        if (matcher.type === "path_glob") {
          if (matchPathGlob(filePath, matcher)) {
            matched = true;
            ruleIds.push(matcher.matcher_id || "path_glob");
          }
        } else if (matcher.type === "content_regex") {
          if (matchContentRegex(diffText, matcher)) {
            matched = true;
            ruleIds.push(matcher.matcher_id || "content_regex");
          }
        }
      }

      if (!matched) continue;

      findings.push({
        mutation_class_id: cls.mutation_class_id,
        class_version: cls.class_version || "1.0.0",
        severity: cls.severity_default,
        implied_authority: cls.implied_authority_default || "none",
        confidence: 1.0,
        match_logic: {
          ruleset_id: catalog.catalog_id,
          rule_ids: ruleIds.length ? ruleIds : ["match"],
        },
        evidence: [
          {
            evidence_type: "file_path",
            path: filePath,
            signals: { matched_class: cls.mutation_class_id },
          },
        ],
      });
    }
  }

const mutationSummary = findings.map(
  f => `${f.mutation_class_id}(${f.severity})`
);

console.log(`::notice::Changed files evaluated: ${changedFiles.length}`);

console.log(
  `::notice::Mutations: ${
    mutationSummary.length ? mutationSummary.join(", ") : "(none)"
  }`
);

  return findings;
}

// --- Policy evaluation --------------------------------------------------------

function authorityRank(a) {
  const map = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return map[String(a || "none")] ?? 0;
}

function evaluatePolicy({ mutations, declaredAuthority }) {
  // Deterministic wedge policy:
  // 1) Any critical severity => fail
  // 2) If implied_authority > declared_authority => fail
  // Otherwise pass
  for (const m of mutations) {
    if (m.severity === "critical") {
      return { decision: "fail", reasons: [`Critical mutation: ${m.mutation_class_id}`] };
    }
    if (authorityRank(m.implied_authority) > authorityRank(declaredAuthority)) {
      return {
        decision: "fail",
        reasons: [`Authority mismatch: ${m.mutation_class_id} implies ${m.implied_authority}, declared ${declaredAuthority}`],
      };
    }
  }
  return { decision: "pass", reasons: [] };
}

// --- Changed-files adapter ----------------------------------------------------
// If you haven’t added getChangedFilesWithDiff yet, we still emit deterministic
// file objects with empty diffText (path_glob classes will still work).

function buildChangedFiles(summary) {
  if (typeof getChangedFilesWithDiff === "function") {
    return getChangedFilesWithDiff(summary.mergeBase);
  }

  // Fallback: path-only changed files from summary.changed_paths
  return (summary.changed_paths || []).map((cp) => ({
    filePath: cp.path,
    diffText: "",
    baseContent: null,
    meta: { status: cp.status },
  }));
}

// --- Meaning artifact output (keep your existing shape, extend) ---------------
// This keeps Run 2 outputs stable while adding mutation report + policy decision.
// If you already have a meaning artifact schema elsewhere, swap this builder.
//

function buildMeaningArtifact({
  intent,
  declaredAuthority,
  diffSummary,
  mutations,
  mutationReport,
  policy,
  registryText,
  bootstrapLockText,
  authority_contract: contract,
}) {
  return {
    schema: "sp.gate.meaning_artifact.v0", // keep yours or replace with your canon schema id
    generated_at: nowIso(),
    posture: {
      worldview_posture: "advisory",
      gate_result: policy.decision,
    },
    intent: {
      mode: intent.intent_mode,
      text: intent.intent_text,
      declared_authority: declaredAuthority,
      raw: intent.raw,
    },
    diff: diffSummary,
    mutation_report: {
      schema: "sp.ebi.mutation_report.v1",
      source: {
        repo: process.env.GITHUB_REPOSITORY || "",
        ref: process.env.GITHUB_REF || "",
      },
      summary: diffSummary,
      mutations,
    },
    policy: {
      decision: policy.decision,
      reasons: policy.reasons,
    },
    inputs: {
      surface_registry_yaml: registryText,
      bootstrap_lock: bootstrapLockText,
    },
  };
}

// --- Main entry ---------------------------------------------------------------

function runGate({ intentPath, registryPath, bootstrapLockPath, meaningOutPath }) {
  // 1) Load inputs
  const intentRaw = readJsonOrThrow(intentPath);
  const intent = normalizeIntent(intentRaw);

  // Prefer AUTHORITY_CONTRACT.json, fallback to INTENT.json
  const contract = loadAuthority({
    authorityPath: process.env.AUTHORITY_CONTRACT_PATH || "AUTHORITY_CONTRACT.json",
    intentPath: intentPath || "AUTHORITY_CONTRACT.json"
  });

  console.log(`::notice::Authority source: ${contract.source_path}`);

  const declaredAuthority =
    contract?.escalation?.tier ||
    intent?.declared_authority ||
    "low";

    const registryText = readTextOrNull(registryPath);
    const bootstrapLockText = readTextOrNull(bootstrapLockPath);

  // 2) Compute diff summary (existing deterministic core)
  const diffSummary = computeDiffSummary();

  // 3) Build changed files
  const changedFiles = buildChangedFiles(diffSummary);

  // 4) Load mutation catalog (default path; override via env if desired)
  const catalogPath =
    process.env.MUTATION_CATALOG_PATH ||
    path.join(process.cwd(), "catalogs", "mutation-classes.default.v1.json");

  const catalog = loadMutationCatalog(catalogPath);

  // 5) Evaluate mutations + policy
  const mutations = evaluateMutations({ changedFiles, catalog });
  const policy = evaluatePolicy({ mutations, declaredAuthority });

	  const mutationReport = {
  schema: "sp.ebi.mutation_report.v1",
  source: {
    repo: process.env.GITHUB_REPOSITORY || "local/test",
    ref: process.env.GITHUB_REF || "refs/heads/local",
  },
  summary: diffSummary,
  mutations,
};

  // 6) Build meaning artifact and write it
  const meaning = buildMeaningArtifact({
    intent,
    declaredAuthority,
    diffSummary,
    mutations,
    policy,
    registryText,
    bootstrapLockText,
    authority_contract: contract,
    mutationReport,
  });

const { execSync } = require("child_process");
const sha =
  process.env.GITHUB_SHA ||
  execSync("git rev-parse --short HEAD").toString().trim();

const runId = `${sha}-${Date.now()}`;
const runDir = `.prism/runs/${runId}`;

require("fs").mkdirSync(runDir, { recursive: true });

const finalMeaningPath = `${runDir}/meaning.json`;
const finalMutationPath = `${runDir}/mutation_report.json`;

writeJson(finalMeaningPath, meaning);
writeJson(finalMutationPath, mutationReport);

console.log(`::notice::Wrote meaning to ${finalMeaningPath}`);
console.log(`::notice::Wrote mutation report to ${finalMutationPath}`);

  // 8) Return result in the shape index.js expects
  // index.js logs these fields today :contentReference[oaicite:5]{index=5}, so keep them present.

  const dominantActionClass = inferDominantActionClassFromMutations(mutations);
  const requiredAuthority = lookupRequiredAuthority(dominantActionClass, registryText);

  return {
    decision: policy.decision === "pass" ? "pass" : "fail",
    reasons: policy.reasons,
    dominant_action_class: dominantActionClass,     // TODO: preserve your existing classifier output here
    required_authority: requiredAuthority,        // TODO: preserve your existing inferred authority here
    declared_authority: declaredAuthority,
    mutation_report: mutationReport
  };
}

module.exports = { runGate };
