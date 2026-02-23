function invokePrism({ prismDef, domainOutput }) {
  const actionClass = domainOutput?.semantic_interpretation?.action_class;
  const deviations = domainOutput?.expectation_evaluation?.deviation_signals || [];

  let concern = "medium";
  let uncertainty = "medium";
  const drivers = [];

  if (deviations.includes("scope_expansion")) {
    concern = "high";
    uncertainty = "low";
    drivers.push("scope_expansion");
  }

  if (actionClass === "systemic") {
    concern = "high";
    uncertainty = "low";
    drivers.push("systemic_change");
  }

  if (drivers.length === 0) drivers.push("default");

  const significance_assessment = {
    concern,
    uncertainty,
  };

  const rationaleTemplate =
    prismDef?.rationale_templates?.find((t) => t.id === "rationale_default")?.template ||
    "Concern is '{concern}' due to '{drivers}'.";

  const rationaleText = String(rationaleTemplate)
    .replace("{concern}", concern)
    .replace("{drivers}", drivers.join(","));

  const sensitivity = prismDef?.sensitivity_indicators || {};
  const escalationLikelihood =
    (concern === "high" && sensitivity?.escalation_likelihood?.high_concern) ||
    (concern === "medium" && sensitivity?.escalation_likelihood?.medium_concern) ||
    sensitivity?.escalation_likelihood?.low_concern ||
    "possible";

  const toleranceBounds = sensitivity?.tolerance_bounds?.default || "unknown";

  return {
    significance_assessment,
    rationale: {
      text: rationaleText,
      drivers,
    },
    sensitivity_indicators: {
      escalation_likelihood: escalationLikelihood,
      tolerance_bounds: toleranceBounds,
    },
  };
}

module.exports = { invokePrism };
