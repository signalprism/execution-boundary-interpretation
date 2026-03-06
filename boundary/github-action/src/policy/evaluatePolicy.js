function authorityRank(a) {
  const map = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return map[a] ?? 0;
}

function evaluatePolicy({ mutations, declaredAuthority }) {
  for (const m of mutations) {
    if (m.severity === "critical") {
      return {
        decision: "fail",
        reasons: [`Critical mutation detected: ${m.mutation_class_id}`]
      };
    }

    if (
      authorityRank(m.implied_authority) >
      authorityRank(declaredAuthority)
    ) {
      return {
        decision: "fail",
        reasons: [`Authority mismatch for ${m.mutation_class_id}`]
      };
    }
  }

  return { decision: "pass", reasons: [] };
}

module.exports = { evaluatePolicy };
