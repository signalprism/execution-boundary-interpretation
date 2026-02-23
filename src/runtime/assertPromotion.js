function assertPromotion(promotion) {
  const status = promotion?.status;
  if (status !== "promoted") {
    throw new Error(
      `Canon bundle not promoted (promotion.status=${String(
        status
      )}). Refusing to execute.`
    );
  }

  const checks = promotion?.promotion_checks || {};
  const required = [
    ["acknowledged_assumptions", true],
    ["authority_review_complete", true],
    ["enforcement_mode_set", true],
  ];

  for (const [k, v] of required) {
    if (checks?.[k] !== v) {
      throw new Error(
        `Promotion check failed: promotion_checks.${k} must be ${v}`
      );
    }
  }

  const promotedBy = promotion?.promoted_by || {};
  if (!promotedBy?.principal_id || !promotedBy?.display_name) {
    throw new Error(
      `Promotion missing promoted_by identity (principal_id/display_name required).`
    );
  }
}

module.exports = { assertPromotion };
