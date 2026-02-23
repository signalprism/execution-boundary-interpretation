const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { execSync } = require("child_process");

const { loadCanonBundle } = require("./runtime/loadCanonBundle");
const { assertPromotion } = require("./runtime/assertPromotion");
const { verifyCanonHashAgainstDisk } = require("./runtime/computeCanonHash");
const { normalizeEvent } = require("./runtime/normalizeEvent");
const { invokeDomainPack } = require("./runtime/invokeDomainPack");
const { invokePrism } = require("./runtime/invokePrism");
const { assembleNarrative } = require("./runtime/assembleNarrative");
const { emitMeaningArtifact } = require("./runtime/emitMeaningArtifact");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readYaml(p) {
  return yaml.load(fs.readFileSync(p, "utf8"));
}

function getChangedFiles() {
  const base = process.env.GITHUB_BASE_REF;
  const head = process.env.GITHUB_HEAD_REF;

  try {
    if (base && head) {
      const cmd = `git diff --name-only origin/${base}...origin/${head}`;
      const out = execSync(cmd, { encoding: "utf8" }).trim();
      return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    }
  } catch (_) {}

  const out = execSync("git diff --name-only HEAD~1...HEAD", {
    encoding: "utf8",
  }).trim();
  return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

function loadRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) return null;
  return readYaml(registryPath);
}

function chooseSurface(_registry) {
  return "github.pull_request";
}

function compareAuthority(required, declared) {
  const order = ["low", "medium", "high", "systemic"];
  const r = order.indexOf(required);
  const d = order.indexOf(declared);
  if (r === -1 || d === -1)
    return { exceeded: true, reason: "unknown_authority_level" };
  return {
    exceeded: r > d,
    reason: r > d ? "declared_authority_insufficient" : null,
  };
}

function runGate({ intentPath, registryPath, bootstrapLockPath, meaningOutPath }) {
  const repoRoot = process.cwd();
  void bootstrapLockPath;

  const bundle = loadCanonBundle(path.join(repoRoot, "canon_bundle"));
  assertPromotion(bundle.promotion);

  const canonId = bundle.canon?.canon_id;
  const canonVersion = bundle.canon?.canon_version;
  if (!canonId || !canonVersion)
    throw new Error("canon.yaml missing canon_id/canon_version");

  const verify = verifyCanonHashAgainstDisk(
    bundle.root,
    canonId,
    canonVersion,
    bundle.bundleIndex
  );
  if (!verify.ok)
    throw new Error(`Canon integrity verification failed: ${verify.reason}`);
  const canonHash = verify.canonHash;

  if (!fs.existsSync(intentPath))
    throw new Error(`INTENT file not found: ${intentPath}`);
  const intent = readJson(intentPath);

  const declared = {
    intent: String(intent.intent || ""),
    authority: String(intent.declared_authority || ""),
  };
  if (!declared.intent || !declared.authority) {
    throw new Error(`INTENT.json must include 'intent' and 'declared_authority'`);
  }

  const registryAbs = path.resolve(repoRoot, registryPath);
  const registry = loadRegistry(registryAbs);
  const surface = chooseSurface(registry);

  const files = getChangedFiles();
  const payload = {
    repo: process.env.GITHUB_REPOSITORY || "unknown",
    files_changed: files,
    diff_summary: files.length
      ? `${files.length} files changed`
      : "no changes detected",
  };

  const event = normalizeEvent({ surface, payload });

  const domainPack = bundle.domain.domain_pack;
  const domainOutput = invokeDomainPack({
    domainPack,
    domainComponents: bundle.domain,
    event,
    declared,
  });

  const prismOutput = invokePrism({
    prismDef: bundle.prism,
    domainOutput,
  });

  const understanding = assembleNarrative({ domainOutput, prismOutput });

  const required = domainOutput.semantic_interpretation.authority_required;
  const declaredAuth = declared.authority;
  const cmp = compareAuthority(required, declaredAuth);

  const systemic = domainOutput.semantic_interpretation.action_class === "systemic";
  const exceeded = cmp.exceeded || systemic;

  const gateResult = exceeded ? "fail" : "pass";
  const reasons = [];
  if (systemic) reasons.push("systemic_change_detected");
  if (cmp.exceeded) reasons.push(cmp.reason);

  const meaning = emitMeaningArtifact({
    canon: { canon_id: canonId, canon_version: canonVersion },
    canonHash,
    domainPack,
    prism: bundle.prism,
    event,
    declared,
    domainOutput,
    prismOutput,
    understanding,
    gateResult,
  });

  const outPath = path.resolve(repoRoot, meaningOutPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(meaning, null, 2) + "\n", "utf8");

  return {
    decision: gateResult === "pass" ? "pass" : "fail",
    reasons: reasons.length ? reasons : gateResult === "pass" ? [] : ["policy_violation"],
    dominant_action_class: domainOutput?.semantic_interpretation?.action_class,
    required_authority: required,
    declared_authority: declaredAuth,
    canon_id: canonId,
    canon_version: canonVersion,
    canon_hash: canonHash,
    domain_pack_id: domainPack.domain_pack_id,
    domain_pack_version: domainPack.domain_pack_version,
    prism_id: bundle.prism.prism_id,
    prism_version: bundle.prism.prism_version,
    meaning_out_path: outPath,
  };
}

module.exports = { runGate };
