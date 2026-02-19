const { readJson, writeJson, fileExists, readYaml } = require("./io");
const { computeDiffSummary } = require("./diff");
const { matchesAnyPath, matchesAnyExtension } = require("./glob");

const AUTH_ORDER = ["low", "medium", "high", "critical"];
const authIndex = (a) => AUTH_ORDER.indexOf(String(a || "").toLowerCase());
const authGreater = (required, declared) => authIndex(required) > authIndex(declared);

function minimalIntentValidate(intent) {
  const errors = [];
  const mode = String(intent?.mode || "");
  const declared = String(intent?.declared_authority || "").toLowerCase();

  if (!["bootstrap", "normal"].includes(mode)) errors.push("invalid:mode");
  if (!intent?.intent || String(intent.intent).trim().length < 3) errors.push("invalid:intent");
  if (!AUTH_ORDER.includes(declared)) errors.push("invalid:declared_authority");

  if (mode === "bootstrap") {
    const bs = intent.bootstrap_scope;
    if (!bs) errors.push("bootstrap_requires:bootstrap_scope");
    else {
      if (!Array.isArray(bs.allowed_paths)) errors.push("bootstrap_requires:bootstrap_scope.allowed_paths");
      if (!Array.isArray(bs.allowed_action_classes)) errors.push("bootstrap_requires:bootstrap_scope.allowed_action_classes");
      if (!bs.caps) errors.push("bootstrap_requires:bootstrap_scope.caps");
      else {
        for (const k of ["max_files_added", "max_total_loc_added", "max_new_top_level_dirs"]) {
          if (typeof bs.caps[k] !== "number") errors.push(`bootstrap_caps_requires:${k}`);
        }
      }
    }
  }
  return errors;
}

function actionClassMatches(def, diff) {
  const match = def.match || {};

  if (Array.isArray(match.any_paths)) {
    for (const p of diff.changed_paths) if (matchesAnyPath(p.path, match.any_paths)) return true;
  }
  if (Array.isArray(match.any_extensions)) {
    for (const p of diff.changed_paths) if (matchesAnyExtension(p.path, match.any_extensions)) return true;
  }
  if (match.heuristics) {
    const h = match.heuristics;
    if (typeof h.files_added_gte === "number" && diff.files_added < h.files_added_gte) return false;
    if (typeof h.total_loc_added_gte === "number" && diff.total_loc_added < h.total_loc_added_gte) return false;
    if (typeof h.new_top_level_dirs_gte === "number" && diff.new_top_level_dirs < h.new_top_level_dirs_gte) return false;
    return true;
  }
  return false;
}

function pickDominant(matchedIds, classesById) {
  let dom = matchedIds[0];
  for (const id of matchedIds) {
    const a = classesById[id];
    const b = classesById[dom];
    if (!a || !b) continue;
    if (authGreater(a.min_authority, b.min_authority)) dom = id;
  }
  return dom;
}

function runGate({ intentPath, registryPath, bootstrapLockPath, meaningOutPath }) {
  const intent = readJson(intentPath);
  const registry = readYaml(registryPath);

  const intentErrors = minimalIntentValidate(intent);
  if (intentErrors.length) {
    const meaning = {
      run: "2",
      mode: intent?.mode ?? null,
      dominant_action_class: null,
      required_authority: null,
      declared_authority: intent?.declared_authority ?? null,
      decision: "fail",
      reasons: intentErrors,
      diff_summary: null
    };
    writeJson(meaningOutPath, meaning);
    return meaning;
  }

  const diff = computeDiffSummary(); // deterministic from git
  const reasons = [];

  // Step 1: Disallow (optional)
  const disallow = intent.disallow || {};
  if (Array.isArray(disallow.path_globs)) {
    for (const p of diff.changed_paths) {
      if (matchesAnyPath(p.path, disallow.path_globs)) reasons.push(`disallowed_path:${p.path}`);
    }
  }
  if (Array.isArray(disallow.file_extensions)) {
    for (const p of diff.changed_paths) {
      if (matchesAnyExtension(p.path, disallow.file_extensions)) reasons.push(`disallowed_extension:${p.path}`);
    }
  }
  if (reasons.length) return emitFail();

  // Step 2: Run 1 path allowlist (non-breaking: only if present)
  let allowPaths = null;
  if (intent.mode === "bootstrap") allowPaths = intent.bootstrap_scope.allowed_paths;
  else if (Array.isArray(intent.allowed_paths)) allowPaths = intent.allowed_paths;

  if (Array.isArray(allowPaths) && allowPaths.length) {
    for (const p of diff.changed_paths) {
      if (!matchesAnyPath(p.path, allowPaths)) reasons.push(`run1_path_outside_allowlist:${p.path}`);
    }
  }
  if (reasons.length) return emitFail();

  // Step 3: Classify action classes
  const classesById = registry.action_classes || {};
  const matched = [];
  for (const [id, def] of Object.entries(classesById)) {
    if (actionClassMatches(def, diff)) matched.push(id);
  }
  if (!matched.length) matched.push("code_change");

  const dominant = pickDominant(matched, classesById);
  let required = (classesById[dominant] && classesById[dominant].min_authority) || "medium";

  // Bootstrap mode inherently requires high authority
  if (intent.mode === "bootstrap" && authIndex(required) < authIndex("high")) {
    required = "high";
  } 
	

  // Step 4: Authority compare
  const declared = String(intent.declared_authority).toLowerCase();
  if (authGreater(required, declared)) {
    reasons.push(`authority_exceeded:required=${required},declared=${declared}`);
  }

  // Step 5: Mode constraints
  const lockExists = fileExists(bootstrapLockPath);

  if (intent.mode === "normal") {
    if (dominant === "new_codebase") reasons.push("normal_mode_forbids_new_codebase");
    if (Array.isArray(intent.allowed_action_classes) && intent.allowed_action_classes.length) {
      if (!intent.allowed_action_classes.includes(dominant)) reasons.push(`action_class_not_allowed:${dominant}`);
    }
  } else {
    if (lockExists) reasons.push("bootstrap_forbidden:bootstrap_lock_exists");

    const bs = intent.bootstrap_scope;
    if (Array.isArray(bs.allowed_action_classes) && bs.allowed_action_classes.length) {
      if (!bs.allowed_action_classes.includes(dominant)) reasons.push(`bootstrap_action_class_not_allowed:${dominant}`);
    }
    const caps = bs.caps;
    if (diff.files_added > caps.max_files_added) reasons.push("bootstrap_cap_exceeded:max_files_added");
    if (diff.total_loc_added > caps.max_total_loc_added) reasons.push("bootstrap_cap_exceeded:max_total_loc_added");
    if (diff.new_top_level_dirs > caps.max_new_top_level_dirs) reasons.push("bootstrap_cap_exceeded:max_new_top_level_dirs");
  }

  if (reasons.length) return emitFail();

  // PASS
  const meaning = {
    run: "2",
    mode: intent.mode,
    dominant_action_class: dominant,
    required_authority: required,
    declared_authority: declared,
    decision: "pass",
    reasons: [],
    diff_summary: summarize(diff)
  };
  writeJson(meaningOutPath, meaning);
  return meaning;

  function summarize(d) {
    return {
      files_added: d.files_added,
      files_modified: d.files_modified,
      files_deleted: d.files_deleted,
      total_loc_added: d.total_loc_added,
      total_loc_deleted: d.total_loc_deleted,
      new_top_level_dirs: d.new_top_level_dirs
    };
  }

  function emitFail() {
    const meaning = {
      run: "2",
      mode: intent.mode,
      dominant_action_class: dominant || null,
      required_authority: required || null,
      declared_authority: declared,
      decision: "fail",
      reasons,
      diff_summary: summarize(diff)
    };
    writeJson(meaningOutPath, meaning);
    return meaning;
  }
}

module.exports = { runGate };
