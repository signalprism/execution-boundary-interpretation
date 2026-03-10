export type AuthorityLevel = "low" | "medium" | "high";
export type SeverityLevel = "low" | "moderate" | "high" | "critical";

export type DecisionResult = "allow" | "deny" | "escalate" | "advisory";

export interface DecideActionInput {
  actorProfile: {
    actor_id: string;
    actor_type: string;
    max_authority: AuthorityLevel;
    forbidden_actions?: string[];
    allowed_intents?: string[];
  };

  actorType: string;

  declaredIntent: string;

  requestedActionType: string;

  signalTrustTier: "trusted" | "constrained" | "untrusted";

  severity: SeverityLevel;

  requiredAuthority: AuthorityLevel;

  mode: "advisory" | "enforce";
}

export interface ActionDecision {
  result: DecisionResult;
  reasonCodes: string[];
  summary: string;
}

const authorityRank: Record<AuthorityLevel, number> = {
  low: 1,
  medium: 2,
  high: 3
};

function authorityExceeds(actorMax: AuthorityLevel, required: AuthorityLevel): boolean {
  return authorityRank[required] > authorityRank[actorMax];
}

function isCritical(severity: SeverityLevel): boolean {
  return severity === "critical";
}

function isHigh(severity: SeverityLevel): boolean {
  return severity === "high" || severity === "critical";
}

export function decideAction(input: DecideActionInput): ActionDecision {
  const {
    actorProfile,
    actorType,
    declaredIntent,
    requestedActionType,
    signalTrustTier,
    severity,
    requiredAuthority,
    mode
  } = input;

  const reasonCodes: string[] = [];

  // Rule 1 — actor forbidden action
  if (actorProfile.forbidden_actions?.includes(requestedActionType)) {
    reasonCodes.push("ACTOR_FORBIDDEN_ACTION");

    return {
      result: "deny",
      reasonCodes,
      summary: `Actor ${actorProfile.actor_id} is not permitted to perform ${requestedActionType}`
    };
  }

  // Rule 2 — authority exceeded
  if (authorityExceeds(actorProfile.max_authority, requiredAuthority)) {
    reasonCodes.push("ACTOR_AUTHORITY_EXCEEDED");

    return {
      result: "deny",
      reasonCodes,
      summary: `Actor authority (${actorProfile.max_authority}) insufficient for ${requestedActionType}`
    };
  }

  // Rule 3 — untrusted signal + critical action
  if (signalTrustTier === "untrusted" && isCritical(severity)) {
    reasonCodes.push("UNTRUSTED_SIGNAL_CRITICAL_ACTION");

    return {
      result: "deny",
      reasonCodes,
      summary: "Untrusted signal cannot authorize critical action"
    };
  }

  // Rule 4 — untrusted signal + high action
  if (signalTrustTier === "untrusted" && isHigh(severity)) {
    reasonCodes.push("UNTRUSTED_SIGNAL_HIGH_RISK_ACTION");

    if (mode === "enforce") {
      return {
        result: "deny",
        reasonCodes,
        summary: "Untrusted signal cannot authorize high-risk action"
      };
    }

    return {
      result: "advisory",
      reasonCodes,
      summary: "High-risk action initiated by untrusted signal"
    };
  }

  // Rule 5 — intent mismatch
  if (
    actorProfile.allowed_intents &&
    !actorProfile.allowed_intents.includes(declaredIntent)
  ) {
    reasonCodes.push("INTENT_MISMATCH");

    return {
      result: "escalate",
      reasonCodes,
      summary: `Declared intent '${declaredIntent}' not permitted for actor`
    };
  }

  // Default allow
  return {
    result: "allow",
    reasonCodes,
    summary: "Action permitted within authority envelope"
  };
}
