import fs from "fs";
import path from "path";

import { normalizeGithubEvent } from "./normalizeGithubEvent";
import { classifyAction } from "./classifyAction";
import { resolveActorProfile } from "./resolveActorProfile";
import { decideAction } from "./decideAction";
import { emitActionDecisionArtifact } from "./emitActionDecisionArtifact";

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function run() {
  const root = path.resolve(__dirname, "..");

  const actorCatalogPath = path.join(root, "catalogs", "actor-profiles.default.v1.json");
  const signalCatalogPath = path.join(root, "catalogs", "signal-surfaces.default.v1.json");

  const actorCatalog = readJson(actorCatalogPath);
  const signalCatalog = readJson(signalCatalogPath);

  const request = normalizeGithubEvent();

  const actorProfile = resolveActorProfile(request.actor.actor_id, actorCatalog);
  if (!actorProfile) {
    throw new Error(`Unknown actor profile: ${request.actor.actor_id}`);
  }

  // optional sanity check against signal catalog
  const knownSignal = signalCatalog.surfaces.find(
    (entry: any) => entry.surface === request.source_signal.surface
  );

  if (!knownSignal) {
    throw new Error(`Unknown signal surface: ${request.source_signal.surface}`);
  }

  const classified = classifyAction({
    eventName: request.context?.event_name,
    workflowName: request.context?.workflow_name,
    touchedFiles: request.context?.touched_files,
    commands: request.context?.commands,
  });

  const requestedAction = {
    ...request.requested_action,
    action_type: classified.actionType,
    required_authority: classified.requiredAuthority,
    severity: classified.severity,
  };

  const decision = decideAction({
    actorProfile,
    actorType: request.actor.actor_type,
    declaredIntent: request.declared_intent.intent_type,
    requestedActionType: requestedAction.action_type,
    signalTrustTier: request.source_signal.trust_tier,
    severity: requestedAction.severity,
    requiredAuthority: requestedAction.required_authority,
    mode: "enforce",
  });

  const artifact = emitActionDecisionArtifact({
    request: {
      ...request,
      requested_action: requestedAction,
    },
    decision,
    mode: "enforce",
  });

  const outputPath = path.join(process.cwd(), "action_decision_artifact.json");
  writeJson(outputPath, artifact);

  console.log(`Wrote ${outputPath}`);
  console.log(`Decision: ${decision.result}`);

  if (decision.result === "deny" || decision.result === "escalate") {
    process.exit(1);
  }

  process.exit(0);
}

run();
