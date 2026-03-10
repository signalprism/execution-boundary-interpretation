import type { ActorType } from "./normalizeGithubEvent";

export interface ActorProfile {
  actor_id: string;
  actor_type: ActorType;
  identity_confidence: "high" | "medium" | "low" | "unknown";
  max_authority: "low" | "medium" | "high";
  allowed_intents?: string[];
  forbidden_actions?: string[];
}

export interface ActorCatalog {
  schema: string;
  catalog_id: string;
  catalog_version: string;
  actors: ActorProfile[];
}

function normalizeActorLogin(login: string): string {
  return login.toLowerCase();
}

function isGithubBot(login: string): boolean {
  return login.endsWith("[bot]");
}

function stripBotSuffix(login: string): string {
  if (login.endsWith("[bot]")) {
    return login.replace("[bot]", "");
  }
  return login;
}

export function resolveActorProfile(
  actorLogin: string,
  catalog: ActorCatalog
): ActorProfile | undefined {
  const normalized = normalizeActorLogin(actorLogin);

  // 1. direct catalog match
  const direct = catalog.actors.find(
    (actor) => normalizeActorLogin(actor.actor_id) === normalized
  );

  if (direct) {
    return direct;
  }

  // 2. bot alias match
  if (isGithubBot(normalized)) {
    const stripped = stripBotSuffix(normalized);

    const botMatch = catalog.actors.find(
      (actor) => normalizeActorLogin(actor.actor_id) === stripped
    );

    if (botMatch) {
      return botMatch;
    }
  }

  // 3. fallback for github-actions
  if (normalized === "github-actions" || normalized === "github-actions[bot]") {
    const automationProfile = catalog.actors.find(
      (actor) => actor.actor_type === "automation"
    );

    if (automationProfile) {
      return automationProfile;
    }
  }

  // 4. fallback for unknown bots
  if (isGithubBot(normalized)) {
    return {
      actor_id: actorLogin,
      actor_type: "automation",
      identity_confidence: "medium",
      max_authority: "low",
      allowed_intents: ["maintenance"],
      forbidden_actions: [
        "package.publish",
        "secret.read",
        "workflow.modify"
      ]
    };
  }

  // 5. fallback human profile
  return {
    actor_id: actorLogin,
    actor_type: "human",
    identity_confidence: "low",
    max_authority: "medium",
    allowed_intents: ["maintenance"],
    forbidden_actions: []
  };
}
