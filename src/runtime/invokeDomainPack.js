function containsWorkflowChange(filesChanged = []) {
  return filesChanged.some((f) => f.startsWith(".github/workflows/"));
}

function summarizeChange(payload) {
  if (payload?.diff_summary) return payload.diff_summary;
  const files = payload?.files_changed || [];
  if (files.length === 0) return "no files reported";
  if (files.length === 1) return files[0];
  return `${files.length} files changed`;
}

function applyInterpretiveRules(domainRules, event, declared) {
  const surface = event.surface;
  const payload = event.payload || {};
  const filesChanged = payload.files_changed || [];

  let action_class = "mutate";
  if (surface === "github.pull_request") {
    action_class = containsWorkflowChange(filesChanged) ? "systemic" : "mutate";
  } else if (surface === "agent.tool_call") {
    const tool = payload?.tool;
    if (tool && ["github.create_pull_request", "github.merge_pull_request"].includes(tool)) {
      action_class = "externalize";
    } else {
      action_class = "mutate";
    }
  }

  const authorityMap =
    domainRules?.authority_map || {
      read: "low",
      mutate: "medium",
      delete: "high",
      externalize: "high",
      elevate: "systemic",
      systemic: "systemic",
    };

  const authority_required = authorityMap[action_class] || "medium";

  let reversibility = "unknown";
  if (action_class === "systemic") reversibility = "low";
  else if (action_class === "externalize") reversibility = "medium";
  else if (action_class === "mutate") reversibility = "high";

  const deviation_signals = [];
  let alignment = "unknown";

  if (action_class === "systemic") deviation_signals.push("scope_expansion");

  const intent = String(declared?.intent || "");
  if (surface === "github.pull_request") {
    if (intent.toLowerCase().includes("deps") && filesChanged.some((f) => f.startsWith("src/"))) {
      deviation_signals.push("unexpected_change_class");
    }
  }

  alignment = deviation_signals.length === 0 ? "aligned" : "deviates";

  return {
    semantic_interpretation: {
      action_class,
      authority_required,
      change_summary: summarizeChange(payload),
    },
    expectation_evaluation: {
      alignment,
      deviation_signals,
    },
    interpretive_signals: {
      reversibility,
    },
  };
}

function renderFragments(fragmentSpec, vars) {
  const fragments = fragmentSpec?.fragments || {};
  const out = {};

  const interpolate = (tmpl) =>
    String(tmpl || "").replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{${k}}`
    );

  for (const [k, v] of Object.entries(fragments)) {
    if (typeof v?.template === "string") out[k] = interpolate(v.template);
  }
  return out;
}

function invokeDomainPack({ domainPack, domainComponents, event, declared }) {
  const rulesYaml = domainComponents?.interpretive_rules || {};
  const domainRules = {
    authority_map:
      rulesYaml?.rules?.find((r) => r.rule_id === "infer_authority_required")?.authority_map,
  };

  const base = applyInterpretiveRules(domainRules, event, declared);

  const vars = {
    surface: event.surface,
    change_summary: base.semantic_interpretation.change_summary,
    intent: declared.intent,
    declared_authority: declared.authority,
    action_class: base.semantic_interpretation.action_class,
    authority_required: base.semantic_interpretation.authority_required,
    alignment: base.expectation_evaluation.alignment,
    deviation_signals: JSON.stringify(base.expectation_evaluation.deviation_signals),
    reversibility: base.interpretive_signals.reversibility,
  };

  const narrative_fragments = renderFragments(
    domainComponents?.narrative_fragments,
    vars
  );

  return {
    semantic_interpretation: base.semantic_interpretation,
    expectation_evaluation: base.expectation_evaluation,
    interpretive_signals: base.interpretive_signals,
    narrative_fragments,
  };
}

module.exports = { invokeDomainPack };
