import crypto from "crypto";
import { ActionDecision } from "./decideAction";

export interface ActionDecisionArtifactInput {
  request: any;
  decision: ActionDecision;
  mode: "advisory" | "enforce";
}

export interface ActionDecisionArtifact {
  schema: "sp.action_decision_artifact.v1";
  request_id: string;

  actor: {
    actor_id: string;
    actor_type: string;
  };

  source_signal: {
    surface: string;
    trust_tier: string;
    content_ref?: string;
  };

  declared_intent: {
    intent_type: string;
    intent_version: string;
  };

  requested_action: {
    action_type: string;
    target?: string;
    required_authority?: string;
    severity?: string;
  };

  decision: {
    result: string;
    reason_codes: string[];
    summary: string;
  };

  posture: {
    mode: "advisory" | "enforce";
  };

  integrity: {
    canonicalization: string;
    hash_algorithm: string;
    artifact_hash: string;
  };
}

function canonicalize(obj: any): string {
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalize).join(",")}]`;
  }

  if (obj !== null && typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const entries = keys.map(
      (k) => `"${k}":${canonicalize(obj[k])}`
    );
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(obj);
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function emitActionDecisionArtifact(
  input: ActionDecisionArtifactInput
): ActionDecisionArtifact {

  const { request, decision, mode } = input;

  const artifact: Omit<ActionDecisionArtifact, "integrity"> = {
    schema: "sp.action_decision_artifact.v1",

    request_id: request.request_id,

    actor: {
      actor_id: request.actor.actor_id,
      actor_type: request.actor.actor_type
    },

    source_signal: {
      surface: request.source_signal.surface,
      trust_tier: request.source_signal.trust_tier,
      content_ref: request.source_signal.content_ref
    },

    declared_intent: request.declared_intent,

    requested_action: request.requested_action,

    decision: {
      result: decision.result,
      reason_codes: decision.reasonCodes,
      summary: decision.summary
    },

    posture: {
      mode
    }
  };

  // Canonicalize without integrity
  const canonical = canonicalize(artifact);

  const hash = sha256(canonical);

  return {
    ...artifact,
    integrity: {
      canonicalization: "sp.canonicalization.v1",
      hash_algorithm: "sha256",
      artifact_hash: hash
    }
  };
}
