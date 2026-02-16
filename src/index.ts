import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "fs";
import Ajv from "ajv";

type Intent = {
  agent?: string;
  scope: string[];
  mutation_class: "patch" | "refactor" | "rename" | "delete";
  max_files: number;
  allow_deletions?: boolean;
  allow_renames?: boolean;
  allow_moves?: boolean;
};

type ChangedFile = {
  filename: string;
  previous_filename?: string;
  status: string; // added | modified | removed | renamed | ...
};

const INTENT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["scope", "mutation_class", "max_files"],
  properties: {
    agent: { type: "string" },
    scope: { type: "array", items: { type: "string" } },
    mutation_class: { type: "string", enum: ["patch", "refactor", "rename", "delete"] },
    max_files: { type: "integer", minimum: 1 },
    allow_deletions: { type: "boolean", default: false },
    allow_renames: { type: "boolean", default: false },
    allow_moves: { type: "boolean", default: false }
  }
} as const;

function parseFailOn(input: string): Set<string> {
  // e.g. "scope,file_count,deletions"
  return new Set(
    (input || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function inScope(intent: Intent, filePath: string): boolean {
  return intent.scope.some(prefix => filePath.startsWith(prefix));
}

function dirPrefix(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/") + "/";
}

function addSummaryLine(line: string) {
  core.summary.addRaw(line + "\n");
}

async function run() {
  try {
    const intentPath = core.getInput("intent_path") || "INTENT.json";
    const failOn = parseFailOn(core.getInput("fail_on") || "scope,file_count,deletions");

    if (!fs.existsSync(intentPath)) {
      core.setFailed(`Intent file not found at ${intentPath}`);
      return;
    }

    const intent: Intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));

    // Validate schema
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(INTENT_SCHEMA);

    if (!validate(intent)) {
      core.setFailed(`Invalid INTENT.json: ${JSON.stringify(validate.errors)}`);
      return;
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      core.setFailed("GITHUB_TOKEN not available.");
      return;
    }

    const context = github.context;

    if (!context.payload.pull_request) {
      core.info("Not a pull request. Skipping.");
      return;
    }

    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request.number;
    const octokit = github.getOctokit(token);

    const files = await octokit.paginate(
      octokit.rest.pulls.listFiles,
      { owner, repo, pull_number: prNumber, per_page: 100 }
    );

    const changedFiles: ChangedFile[] = files.map(f => ({
      filename: f.filename,
      previous_filename: (f as any).previous_filename as string | undefined,
      status: f.status
    }));

    const declared = {
      agent: intent.agent ?? "unknown",
      scope: intent.scope.join(", "),
      mutation_class: intent.mutation_class,
      max_files: intent.max_files,
      allow_deletions: !!intent.allow_deletions,
      allow_renames: !!intent.allow_renames,
      allow_moves: !!intent.allow_moves
    };

    // Summaries for reporting
    const violations: { rule: string; message: string }[] = [];

    // Rule: file_count
    if (changedFiles.length > intent.max_files) {
      violations.push({
        rule: "file_count",
        message: `File count exceeded: ${changedFiles.length} > declared max ${intent.max_files}`
      });
    }

    // Rule: scope (check both old + new name for renames)
    const outOfScope = changedFiles.filter(f => {
      if (f.status === "renamed" && f.previous_filename) {
        return !inScope(intent, f.filename) || !inScope(intent, f.previous_filename);
      }
      return !inScope(intent, f.filename);
    });

    if (outOfScope.length > 0) {
      violations.push({
        rule: "scope",
        message:
          `Out-of-scope modifications:\n` +
          outOfScope
            .map(f => (f.status === "renamed" && f.previous_filename)
              ? `${f.previous_filename} -> ${f.filename}`
              : f.filename
            )
            .join("\n")
      });
    }

    // Rule: deletions
    const deletions = changedFiles.filter(f => f.status === "removed");
    if (!intent.allow_deletions && deletions.length > 0) {
      violations.push({
        rule: "deletions",
        message: `Deletions detected but not declared:\n${deletions.map(f => f.filename).join("\n")}`
      });
    }

    // Rule: renames / moves
    const renames = changedFiles.filter(f => f.status === "renamed" && !!f.previous_filename);
    if (renames.length > 0) {
      if (!intent.allow_renames && intent.mutation_class !== "rename") {
        violations.push({
          rule: "renames",
          message: `Renames detected but not declared:\n${renames
            .map(r => `${r.previous_filename} -> ${r.filename}`)
            .join("\n")}`
        });
      }

      const moves = renames.filter(r => {
        const prev = dirPrefix(r.previous_filename!);
        const next = dirPrefix(r.filename);
        return prev !== next;
      });

      if (moves.length > 0 && !intent.allow_moves && intent.mutation_class !== "rename") {
        violations.push({
          rule: "moves",
          message: `Moves detected but not declared:\n${moves
            .map(m => `${m.previous_filename} -> ${m.filename}`)
            .join("\n")}`
        });
      }
    }

    // Write a Job Summary
    await core.summary
      .addHeading("Agent Write Guard")
      .addTable([
        [
          { data: "Declared", header: true },
          { data: "Value", header: true }
        ],
        ["agent", declared.agent],
        ["scope", declared.scope],
        ["mutation_class", declared.mutation_class],
        ["max_files", String(declared.max_files)],
        ["allow_deletions", String(declared.allow_deletions)],
        ["allow_renames", String(declared.allow_renames)],
        ["allow_moves", String(declared.allow_moves)]
      ])
      .addHeading("Actual")
      .addRaw(`Changed files: ${changedFiles.length}\n\n`)
      .addRaw(changedFiles.map(f =>
        f.status === "renamed" && f.previous_filename
          ? `- [${f.status}] ${f.previous_filename} -> ${f.filename}`
          : `- [${f.status}] ${f.filename}`
      ).join("\n") + "\n\n")
      .addHeading("Violations");

    if (violations.length === 0) {
      addSummaryLine("✅ No violations.");
      await core.summary.write();
      core.info("Agent Write Guard passed.");
      return;
    }

    addSummaryLine(`Found ${violations.length} violation(s):`);
    violations.forEach(v => {
      addSummaryLine(`- **${v.rule}**: ${v.message.replace(/\n/g, " / ")}`);
    });

    await core.summary.write();

    // Fail behavior controlled by fail_on
    const failing = violations.filter(v => failOn.has(v.rule));
    if (failing.length > 0) {
      core.setFailed(
        failing.map(v => `[${v.rule}] ${v.message}`).join("\n\n")
      );
      return;
    }

    // If violations exist but are not configured to fail, warn only
    violations.forEach(v => core.warning(`[${v.rule}] ${v.message}`));
    core.info("Violations present but not configured to fail build (fail_on).");

  } catch (error: any) {
    core.setFailed(error?.message ?? String(error));
  }
}

run();