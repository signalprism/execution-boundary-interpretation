import fs from "fs";

export type ActorType =
  | "human"
  | "service"
  | "ci"
  | "automation"
  | "ai_agent"
  | "external";

export type TrustTier = "trusted" | "constrained" | "untrusted";

export interface AgentActionRequest {
  schema: "sp.agent_action_request.v1";
  request_id: string;
  actor: {
    actor_id: string;
    actor_type: ActorType;
    identity_confidence: "high" | "medium" | "low" | "unknown";
  };
  source_signal: {
    surface: string;
    trust_tier: TrustTier;
    content_ref?: string;
  };
  declared_intent: {
    intent_type: string;
    intent_version: string;
  };
  requested_action: {
    action_type: string;
    target?: string;
  };
  context: {
    repository?: string;
    branch?: string;
    event_name?: string;
    workflow_name?: string;
    actor_login?: string;
    issue_number?: number;
    pull_request_number?: number;
    release_tag?: string;
    touched_files?: string[];
    commands?: string[];
    raw_event_ref?: string;
  };
}

export interface NormalizeGithubEventOptions {
  actorTypeResolver?: (actorLogin: string, workflowName?: string) => ActorType;
  declaredIntentResolver?: (eventName: string, workflowName?: string) => string;
  requestedActionResolver?: (eventName: string, payload: any) => string;
  requestIdFactory?: () => string;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}

function safeReadJson(filePath: string): any {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to read GitHub event payload at ${filePath}: ${String(error)}`);
  }
}

function defaultRequestIdFactory(): string {
  const runId = readOptionalEnv("GITHUB_RUN_ID") ?? "local";
  const runAttempt = readOptionalEnv("GITHUB_RUN_ATTEMPT") ?? "1";
  return `gha_${runId}_${runAttempt}`;
}

function defaultActorTypeResolver(actorLogin: string, workflowName?: string): ActorType {
  const actor = actorLogin.toLowerCase();
  const workflow = (workflowName ?? "").toLowerCase();

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

function defaultDeclaredIntentResolver(eventName: string, workflowName?: string): string {
  const workflow = (workflowName ?? "").toLowerCase();

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

function defaultRequestedActionResolver(eventName: string, payload: any): string {
  switch (eventName) {
    case "issues":
    case "issue_comment":
      return "issue.comment";
    case "pull_request":
    case "pull_request_target":
      return "repo.pull_request.open";
    case "release":
      return "release.create";
    case "workflow_dispatch":
      return "workflow.dispatch";
    default:
      return "repo.commit";
  }
}

function resolveSourceSignal(
  eventName: string,
  payload: any
): { surface: string; trust_tier: TrustTier; content_ref?: string } {
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

function resolveTarget(eventName: string, payload: any): string | undefined {
  switch (eventName) {
    case "issues":
    case "issue_comment":
      return payload?.repository?.full_name;
    case "pull_request":
    case "pull_request_target":
      return payload?.pull_request?.html_url ?? payload?.repository?.full_name;
    case "workflow_dispatch":
      return payload?.repository?.full_name;
    case "release":
      return payload?.release?.tag_name;
    default:
      return payload?.repository?.full_name;
  }
}

function resolveBranch(payload: any): string | undefined {
  const ref: string | undefined = payload?.ref;
  if (!ref) return undefined;

  if (ref.startsWith("refs/heads/")) {
    return ref.replace("refs/heads/", "");
  }

  return ref;
}

function extractCommands(payload: any): string[] {
  const commands: string[] = [];

  const issueTitle = payload?.issue?.title;
  const issueBody = payload?.issue?.body;
  const commentBody = payload?.comment?.body;
  const prTitle = payload?.pull_request?.title;
  const prBody = payload?.pull_request?.body;
  const releaseBody = payload?.release?.body;

  const textBlobs = [issueTitle, issueBody, commentBody, prTitle, prBody, releaseBody]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const text of textBlobs) {
    const lowered = text.toLowerCase();

    if (lowered.includes("npm publish")) commands.push("npm publish");
    if (lowered.includes("gh release create")) commands.push("gh release create");
    if (lowered.includes("workflow")) commands.push("workflow reference");
  }

  return [...new Set(commands)];
}

export function normalizeGithubEvent(
  options: NormalizeGithubEventOptions = {}
): AgentActionRequest {
  const eventPath = readRequiredEnv("GITHUB_EVENT_PATH");
  const eventName = readRequiredEnv("GITHUB_EVENT_NAME");
  const actorLogin = readOptionalEnv("GITHUB_ACTOR") ?? "unknown-actor";
  const workflowName = readOptionalEnv("GITHUB_WORKFLOW");
  const repository = readOptionalEnv("GITHUB_REPOSITORY");

  const payload = safeReadJson(eventPath);

  const actorType =
    options.actorTypeResolver?.(actorLogin, workflowName) ??
    defaultActorTypeResolver(actorLogin, workflowName);

  const declaredIntent =
    options.declaredIntentResolver?.(eventName, workflowName) ??
    defaultDeclaredIntentResolver(eventName, workflowName);

  const requestedAction =
    options.requestedActionResolver?.(eventName, payload) ??
    defaultRequestedActionResolver(eventName, payload);

  const sourceSignal = resolveSourceSignal(eventName, payload);
  const requestId = options.requestIdFactory?.() ?? defaultRequestIdFactory();

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
      action_type: requestedAction,
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
