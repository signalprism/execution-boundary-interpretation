const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalEnv(name) {
  const value = process.env[name];
  return value && String(value).trim() ? value : undefined;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function ensureCatalogShape(catalog, field) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog[field])) {
    throw new Error(`Invalid catalog shape: expected array field '${field}'`);
  }
}

function normalizeActorLogin(login) {
  return String(login).toLowerCase();
}

function isGithubBot(login) {
  return login.endsWith("[bot]");
}

function stripBotSuffix(login) {
  return isGithubBot(login) ? login.replace("[bot]", "") : login;
}

function resolveActorProfile(actorLogin, catalog) {
  const normalized = normalizeActorLogin(actorLogin);

  const direct = catalog.actors.find(
    (actor) => normalizeActorLogin(actor.actor_id) === normalized
  );
  if (direct) return direct;

  if (isGithubBot(normalized)) {
    const stripped = stripBotSuffix(normalized);
    const botMatch = catalog.actors.find(
      (actor) => normalizeActorLogin(actor.actor_id) === stripped
    );
    if (botMatch) return botMatch;
  }

  if (normalized === "github-actions" || normalized === "github-actions[bot]") {
    const automationProfile = catalog.actors.find(
      (actor) => actor.actor_type === "automation"
    );
    if (automationProfile) return automationProfile;
  }

  if (isGithubBot(normalized)) {
    return {
      actor_id: actorLogin,
      actor_type: "automation",
      identity_confidence: "medium",
      max_authority: "low",
      allowed_intents: ["maintenance"],
      forbidden_actions: ["package.publish", "secret.read", "workflow.modify"],
    };
  }

  return {
    actor_id: actorLogin,
    actor_type: "human",
    identity_confidence: "low",
    max_authority: "medium",
    allowed_intents: ["maintenance"],
    forbidden_actions: [],
  };
}

function resolveSourceSignal(eventName, payload) {
  switch (eventName) {
    case "issues": {
      const issueNumber = payload?.issue?.number;
      return {
        surface: "github.issue.title",
        trust_tier: "untrusted",
        content_ref: issueNumber ? `issue#${issueNumber}` : undefined,
      };
    }

    case "issue_comment": {
      const issueNumber = payload?.issue?.number;
      return {
        surface: "github.issue.comment",
        trust_tier: "untrusted",
        content_ref: issueNumber ? `issue#${issueNumber}` : undefined,
      };
    }

    case "pull_request":
    case "pull_request_target": {
      const prNumber = payload?.pull_request?.number;
      return {
        surface: "github.pull_request.diff",
        trust_tier: "constrained",
        content_ref: prNumber ? `pr#${prNumber}` : undefined,
      };
    }

    case "workflow_dispatch":
      return {
        surface: "github.workflow_dispatch.inputs",
        trust_tier: "constrained",
      };

    case "release": {
      const tag = payload?.release?.tag_name;
      return {
        surface: "github.release.metadata",
        trust_tier: "constrained",
        content_ref: tag ? `release:${tag}` : undefined,
      };
    }

    case "schedule":
      return {
        surface: "github.repo_file.protected",
        trust_tier: "trusted",
      };

    default:
      return {
        surface: "github.unknown",
        trust_tier: "untrusted",
      };
  }
}

function defaultActorTypeResolver(actorLogin, workflowName) {
  const actor = String(actorLogin || "").toLowerCase();
  const workflow = String(workflowName || "").toLowerCase();

  if (
    actor.includes("bot") ||
    workflow.includes("triage") ||
    workflow.includes("assistant") ||
    workflow.includes("agent")
  ) {
    return "ai_agent";
  }

  if (actor === "github-actions[bot]" || actor === "github-actions") {
    return "automation";
  }

  return "human";
}

function defaultDeclaredIntentResolver(eventName, workflowName) {
  const workflow = String(workflowName || "").toLowerCase();

  if (workflow.includes("triage")) return "triage";
  if (workflow.includes("release")) return "release";
  if (workflow.includes("depend") || workflow.includes("update")) return "dependency_update";
  if (workflow.includes("publish")) return "publish";

  switch (eventName) {
    case "issues":
    case "issue_comment":
      return "triage";
    case "pull_request":
    case "pull_request_target":
      return "maintenance";
    case "workflow_dispatch":
      return "maintenance";
    case "release":
      return "release";
    case "schedule":
      return "maintenance";
    default:
      return "maintenance";
  }
}

function resolveTarget(eventName, payload) {
  switch (eventName) {
    case "issues":
    case "issue_comment":
      return payload?.repository?.full_name;
    case "pull_request":
    case "pull_request_target":
      return payload?.pull_request?.html_url || payload?.repository?.full_name;
    case "workflow_dispatch":
      return payload?.repository?.full_name;
    case "release":
      return payload?.release?.tag_name;
    default:
      return payload?.repository?.full_name;
  }
}

function resolveBranch(payload) {
  const ref = payload?.ref;
  if (!ref) return undefined;
  if (ref.startsWith("refs/heads/")) {
    return ref.replace("refs/heads/", "");
  }
  return ref;
}

function extractCommands(payload) {
  const commands = [];

  const issueTitle = payload?.issue?.title;
  const issueBody = payload?.issue?.body;
  const commentBody = payload?.comment?.body;
  const prTitle = payload?.pull_request?.title;
  const prBody = payload?.pull_request?.body;
  const releaseBody = payload?.release?.body;

  const textBlobs = [issueTitle, issueBody, commentBody, prTitle, prBody, releaseBody]
    .filter((value) => typeof value === "string" && value.trim().length > 0);

  for (const text of textBlobs) {
    const lowered = text.toLowerCase();

    if (lowered.includes("npm publish")) commands.push("npm publish");
    if (lowered.includes("gh release create")) commands.push("gh release create");
    if (lowered.includes("workflow")) commands.push("workflow reference");
  }

  return [...new Set(commands)];
}

function normalizeGithubEvent() {
  const eventPath = readRequiredEnv("GITHUB_EVENT_PATH");
  const eventName = readRequiredEnv("GITHUB_EVENT_NAME");
  const actorLogin = readOptionalEnv("GITHUB_ACTOR") || "unknown-actor";
  const workflowName = readOptionalEnv("GITHUB_WORKFLOW");
  const repository = readOptionalEnv("GITHUB_REPOSITORY");
  const payload = readJson(eventPath);

  const runId = readOptionalEnv("GITHUB_RUN_ID") || "local";
  const runAttempt = readOptionalEnv("GITHUB_RUN_ATTEMPT") || "1";
  const requestId = `gha_${runId}_${runAttempt}`;

  const actorType = defaultActorTypeResolver(actorLogin, workflowName);
  const declaredIntent = defaultDeclaredIntentResolver(eventName, workflowName);
  const sourceSignal = resolveSourceSignal(eventName, payload);

  return {
    schema: "sp.agent_action_request.v1",
    request_id: requestId,
    actor: {
      actor_id: actorLogin,
      actor_type: actorType,
      identity_confidence: actorType === "human" ? "high" : "medium",
    },
    source_signal: sourceSignal,
    declared_intent: {
      intent_type: declaredIntent,
      intent_version: "1.0.0",
    },
    requested_action: {
      action_type: "repo.commit",
      target: resolveTarget(eventName, payload),
    },
    context: {
      repository,
      branch: resolveBranch(payload),
      event_name: eventName,
      workflow_name: workflowName,
      actor_login: actorLogin,
      issue_number: payload?.issue?.number,
      pull_request_number: payload?.pull_request?.number,
      release_tag: payload?.release?.tag_name,
      commands: extractCommands(payload),
      raw_event_ref: eventPath,
    },
  };
}

function includesWorkflowModification(files) {
  return files.some((f) => f.startsWith(".github/workflows/"));
}

function includesDependencyModification(files) {
  return files.some(
    (f) =>
      f.endsWith("package.json") ||
      f.endsWith("package-lock.json") ||
      f.endsWith("yarn.lock") ||
      f.endsWith("requirements.txt")
  );
}

function classifyFromCommands(commands) {
  if (!commands || commands.length === 0) return null;
  const normalized = commands.map((c) => c.toLowerCase());

  if (normalized.includes("npm publish")) {
    return {
      actionType: "package.publish",
      severity: "critical",
      requiredAuthority: "high",
    };
  }

  if (normalized.includes("gh release create")) {
    return {
      actionType: "release.create",
      severity: "high",
      requiredAuthority: "high",
    };
  }

  return null;
}

function classifyFromFiles(files) {
  if (!files || files.length === 0) return null;

  if (includesWorkflowModification(files)) {
    return {
      actionType: "workflow.modify",
      severity: "high",
      requiredAuthority: "high",
    };
  }

  if (includesDependencyModification(files)) {
    return {
      actionType: "dependency.modify",
      severity: "moderate",
      requiredAuthority: "medium",
    };
  }

  return null;
}

function classifyFromWorkflowName(workflowName) {
  if (!workflowName) return null;
  const name = String(workflowName).toLowerCase();

  if (name.includes("release")) {
    return {
      actionType: "release.create",
      severity: "high",
      requiredAuthority: "high",
    };
  }

  if (name.includes("publish")) {
    return {
      actionType: "package.publish",
      severity: "critical",
      requiredAuthority: "high",
    };
  }

  if (name.includes("deploy")) {
    return {
      actionType: "deploy.run",
      severity: "high",
      requiredAuthority: "high",
    };
  }

  return null;
}

function classifyFromEvent(eventName) {
  switch (eventName) {
    case "release":
      return {
        actionType: "release.create",
        severity: "high",
        requiredAuthority: "high",
      };

    case "workflow_dispatch":
      return {
        actionType: "workflow.dispatch",
        severity: "moderate",
        requiredAuthority: "medium",
      };

    case "schedule":
      return {
        actionType: "automation.run",
        severity: "low",
        requiredAuthority: "low",
      };

    default:
      return null;
  }
}

function classifyAction(input) {
  const { commands, touchedFiles, workflowName, eventName } = input;

  const commandClassification = classifyFromCommands(commands);
  if (commandClassification) return commandClassification;

  const fileClassification = classifyFromFiles(touchedFiles);
  if (fileClassification) return fileClassification;

  const workflowClassification = classifyFromWorkflowName(workflowName);
  if (workflowClassification) return workflowClassification;

  const eventClassification = classifyFromEvent(eventName);
  if (eventClassification) return eventClassification;

  return {
    actionType: "repo.commit",
    severity: "low",
    requiredAuthority: "low",
  };
}

function decideAction(input) {
  const {
    actorProfile,
    declaredIntent,
    requestedActionType,
    signalTrustTier,
    severity,
    requiredAuthority,
    mode,
  } = input;

  const reasonCodes = [];
  const authorityRank = { low: 1, medium: 2, high: 3 };

  function authorityExceeds(actorMax, required) {
    return authorityRank[required] > authorityRank[actorMax];
  }

  if (actorProfile.forbidden_actions?.includes(requestedActionType)) {
    reasonCodes.push("ACTOR_FORBIDDEN_ACTION");
    return {
      result: "deny",
      reasonCodes,
      summary: `Actor ${actorProfile.actor_id} is not permitted to perform ${requestedActionType}`,
    };
  }

  if (authorityExceeds(actorProfile.max_authority, requiredAuthority)) {
    reasonCodes.push("ACTOR_AUTHORITY_EXCEEDED");
    return {
      result: "deny",
      reasonCodes,
      summary: `Actor authority (${actorProfile.max_authority}) insufficient for ${requestedActionType}`,
    };
  }

  if (signalTrustTier === "untrusted" && severity === "critical") {
    reasonCodes.push("UNTRUSTED_SIGNAL_CRITICAL_ACTION");
    return {
      result: "deny",
      reasonCodes,
      summary: "Untrusted signal cannot authorize critical action",
    };
  }

  if (signalTrustTier === "untrusted" && (severity === "high" || severity === "critical")) {
    reasonCodes.push("UNTRUSTED_SIGNAL_HIGH_RISK_ACTION");
    return {
      result: mode === "enforce" ? "deny" : "advisory",
      reasonCodes,
      summary:
        mode === "enforce"
          ? "Untrusted signal cannot authorize high-risk action"
          : "High-risk action initiated by untrusted signal",
    };
  }

  if (
    actorProfile.allowed_intents &&
    !actorProfile.allowed_intents.includes(declaredIntent)
  ) {
    reasonCodes.push("INTENT_MISMATCH");
    return {
      result: "escalate",
      reasonCodes,
      summary: `Declared intent '${declaredIntent}' not permitted for actor`,
    };
  }

  return {
    result: "allow",
    reasonCodes,
    summary: "Action permitted within authority envelope",
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function emitActionDecisionArtifact(input) {
  const artifact = {
    schema: "sp.action_decision_artifact.v1",
    request_id: input.request.request_id,
    actor: {
      actor_id: input.request.actor.actor_id,
      actor_type: input.request.actor.actor_type,
    },
    source_signal: {
      surface: input.request.source_signal.surface,
      trust_tier: input.request.source_signal.trust_tier,
      content_ref: input.request.source_signal.content_ref,
    },
    declared_intent: input.request.declared_intent,
    requested_action: input.request.requested_action,
    decision: {
      result: input.decision.result,
      reason_codes: input.decision.reasonCodes,
      summary: input.decision.summary,
    },
    posture: {
      mode: input.mode,
    },
  };

  const canonical = canonicalize(artifact);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");

  return {
    ...artifact,
    integrity: {
      canonicalization: "sp.canonicalization.v1",
      hash_algorithm: "sha256",
      artifact_hash: hash,
      signature: "",
    },
  };
}

function runActionBoundary() {
  const repoRoot = process.cwd();

  const actorCatalogPath = process.env.ACTOR_CATALOG_PATH
    ? path.resolve(repoRoot, process.env.ACTOR_CATALOG_PATH)
    : path.resolve(
        repoRoot,
        "boundary",
        "github-action",
        "catalogs",
        "actor-profiles.default.v1.json"
      );

  const signalCatalogPath = process.env.SIGNAL_CATALOG_PATH
    ? path.resolve(repoRoot, process.env.SIGNAL_CATALOG_PATH)
    : path.resolve(
        repoRoot,
        "boundary",
        "github-action",
        "catalogs",
        "signal-surfaces.default.v1.json"
      );

  const actorCatalog = readJson(actorCatalogPath);
  const signalCatalog = readJson(signalCatalogPath);

  ensureCatalogShape(actorCatalog, "actors");
  ensureCatalogShape(signalCatalog, "surfaces");

  const request = normalizeGithubEvent();

  const actorProfile = resolveActorProfile(request.actor.actor_id, actorCatalog);
  if (!actorProfile) {
    throw new Error(`Unknown actor profile: ${request.actor.actor_id}`);
  }

  const knownSignal = signalCatalog.surfaces.find(
    (entry) => entry.surface === request.source_signal.surface
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

  const artifactFileName = ["action", "decision", "artifact.json"].join("_");
  const artifactPath = path.resolve(process.cwd(), artifactFileName);

  writeJson(artifactPath, artifact);

  return {
    request: request,
    classified: classified,
    actorProfile: actorProfile,
    knownSignal: knownSignal,
    decision: decision,
    artifactPath: artifactPath,
  };
}

module.exports = runActionBoundary;
