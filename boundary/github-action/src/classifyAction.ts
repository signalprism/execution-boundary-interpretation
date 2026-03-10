export type AuthorityLevel = "low" | "medium" | "high";

export type SeverityLevel = "low" | "moderate" | "high" | "critical";

export interface ActionClassification {
  actionType: string;
  severity: SeverityLevel;
  requiredAuthority: AuthorityLevel;
}

export interface ClassifyActionInput {
  eventName?: string;
  workflowName?: string;
  touchedFiles?: string[];
  commands?: string[];
}

function includesWorkflowModification(files: string[]): boolean {
  return files.some((f) => f.startsWith(".github/workflows/"));
}

function includesDependencyModification(files: string[]): boolean {
  return files.some(
    (f) =>
      f.endsWith("package.json") ||
      f.endsWith("package-lock.json") ||
      f.endsWith("yarn.lock") ||
      f.endsWith("requirements.txt")
  );
}

function classifyFromCommands(commands?: string[]): ActionClassification | null {
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

function classifyFromFiles(files?: string[]): ActionClassification | null {
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
      severity: "severity",
      requiredAuthority: "medium",
    };
  }

  return null;
}

function classifyFromEvent(eventName?: string): ActionClassification | null {
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

function classifyFromWorkflowName(workflowName?: string): ActionClassification | null {
  if (!workflowName) return null;

  const name = workflowName.toLowerCase();

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

export function classifyAction(input: ClassifyActionInput): ActionClassification {
  const { commands, touchedFiles, eventName, workflowName } = input;

  // 1. command detection (highest confidence)
  const commandClassification = classifyFromCommands(commands);
  if (commandClassification) {
    return commandClassification;
  }

  // 2. file-based classification
  const fileClassification = classifyFromFiles(touchedFiles);
  if (fileClassification) {
    return fileClassification;
  }

  // 3. workflow-name heuristic
  const workflowClassification = classifyFromWorkflowName(workflowName);
  if (workflowClassification) {
    return workflowClassification;
  }

  // 4. event-based classification
  const eventClassification = classifyFromEvent(eventName);
  if (eventClassification) {
    return eventClassification;
  }


  // 5. fallback classification
  return {
    actionType: "repo.commit",
    severity: "low",
    requiredAuthority: "low",
  };
}
