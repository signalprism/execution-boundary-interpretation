function assembleNarrative({ domainOutput, prismOutput }) {
  const fr = domainOutput?.narrative_fragments || {};

  const orderedKeys = [
    "what_happened",
    "declared_intent",
    "interpretation",
    "expectations",
    "reversibility",
    "caution",
  ];

  const fragments = [];
  for (const k of orderedKeys) {
    if (fr[k]) fragments.push(fr[k]);
  }

  if (prismOutput?.rationale?.text) {
    fragments.push(`Prism rationale: ${prismOutput.rationale.text}`);
  }

  const concern = prismOutput?.significance_assessment?.concern || "unknown";
  const summary = `Interpretive summary (dev): concern=${concern}. Advisory meaning only.`;

  return { summary, fragments };
}

module.exports = { assembleNarrative };
