import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "fs";
import Ajv from "ajv";

type MutationClass = "patch" | "refactor" | "rename" | "delete";

type Intent = {
  agent?: string;
  scope: string[]; // allowed path prefixes
  mutation_class: MutationClass;
  max_files: number;
  allow_deletions?: boolean;
  allow_renames?: boolean;
  allow_moves?: boolean;
};

type ChangedFile = {
  filename: string;
  status: string; // added | modified | removed | renamed | ...
  previous_filename?: string;
};

const INTENT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["scope", "mutation_class", "max_files"],
  additionalProperties: true,
  properties: {
    agent: { type: "string" },
    scope: { type: "array", items: { type: "string" }, minItems: 1 },
    mutation_class: { type: "string", enum: ["patch", "refactor", "rename", "delete"] },
    max_files: { type: "integer", minimum: 1 },
    allow_deletions: { type: "boolean", default: false },
    allow_renames: { type: "boolean", default: false },
    allow_moves: { type: "boolean", default: false }
  }
} as const;

function parseCsvSet(input: string | undefined): Set<string> {
  return new Set(
    (input || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function inScope(scopePrefixes: string[], path: string): boolean {
  return scopePrefixes.some(prefix => path.startsWith(prefix));
}

function dirPrefix(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/") + "/";
}

function fmtRename(f: ChangedFile): string {
  if (f.previous_filename) return `${f.previous_filename} -> ${f.filename}`;
  return f.filename;
}

function normalizeBool(v: any): boolean {
  return v === true;
}

async function main() {
  try {
    const intentPath = core.getInput("intent_path") || "INTENT.json";
    const failOn = parseCsvSet(core.getInput("fail_on") || "scope,file_count,deletions");

    // Ensure we're on a PR event
    const pr = github.context.payload.pull_request;
    if (!pr) {
      core.info("No pull_request in event payload. Skipping.");
      return;
    }

    // Load intent
    if (!fs.existsSync(intentPath)) {
      core.setFailed(`Intent file not found at ${intentPath}. Add it to the PR branch.`);
      return;
    }

    let intentRaw: any;
    try {
      intentRaw = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    } catch (e) {
      core.setFailed(`Failed to parse ${intentPath} as JSON. Ensure valid JSON.`);
      return;
    }

    // Validate intent schema
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(INTENT_SCHEMA);

    if (!validate(intentRaw)) {
      core.setFailed(`Invalid INTENT.json schema: ${JSON.stringify(validate.errors)}`);
      return;
    }

    const intent: Intent = {
      agent: intentRaw.agent,
      scope: intentRaw.scope,
      mutation_class: intentRaw.mutation_class,
      max_files: intentRaw.max_files,
      allow_deletions: normalizeBool(intentRaw.allow_deletions),
      allow_renames: normalizeBool(intentRaw.allow_renames),
      allow_moves: normalizeBool(intentRaw.allow_moves)
    };

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      core.setFailed("GITHUB_TOKEN not available. Ensure workflow has permissions and runs in GitHub Actions.");
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const prNumber = pr.number;

    // Fetch PR files (paginate)
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100
    });

    const changedFiles: ChangedFile[] = files.map((f: any) => ({
      filename: f.filename,
      status: f.status,
      previous_filename: f.previous_filename
    }));

    // Evaluate deterministic rules
    const violations: { rule: string; message: string; items?: string[] }[] = [];

    // file_count
    if (changedFiles.length > intent.max_files) {
      violations.push({
        rule: "file_count",
        message: `File count exceeded: ${changedFiles.length} > declared max ${intent.max_files}`
      });
    }

    // scope (check new path; if renamed, check both old and new)
    const outOfScope = changedFiles.filter(f => {
      if (f.status === "renamed" && f.previous_filename) {
        return !inScope(intent.scope, f.filename) || !inScope(intent.scope, f.previous_filename);
      }
      return !inScope(intent.scope, f.filename);
    });

    if (outOfScope.length > 0) {
      violations.push({
        rule: "scope",
        message: "Out-of-scope mutation detected.",
        items: outOfScope.map(f => (f.status === "renamed" ? fmtRename(f) : f.filename))
      });
    }

    // deletions
    const deletions = changedFiles.filter(f => f.status === "removed");
    if (!intent.allow_deletions && deletions.length > 0) {
      violations.push({
        rule: "deletions",
        message: "Deletions detected but not declared.",
        items: deletions.map(f => f.filename)
      });
    }

    // renames
    const renames = changedFiles.filter(f => f.status === "renamed" && !!f.previous_filename);
    if (renames.length > 0) {
      const renameAllowed = intent.allow_renames || intent.mutation_class === "rename";
      if (!renameAllowed) {
        violations.push({
          rule: "renames",
          message: "Renames detected but not declared.",
          items: renames.map(fmtRename)
        });
      }
    }

    // moves (directory changes on renames)
    const moves = renames.filter(r => {
      const prevDir = dirPrefix(r.previous_filename!);
      const nextDir = dirPrefix(r.filename);
      return prevDir !== nextDir;
    });

    if (moves.length > 0) {
      const moveAllowed = intent.allow_moves || intent.mutation_class === "rename";
      if (!moveAllowed) {
        violations.push({
          rule: "moves",
          message: "Moves detected but not declared.",
          items: moves.map(fmtRename)
        });
      }
    }

    // Job Summary (interpretation output)
    await core.summary
      .addHeading("Execution Boundary Interpretation")
      .addParagraph("Declared intent interpreted against actual PR mutations.")
      .addHeading("Declared Intent")
      .addTable([
        [{ data: "Field", header: true }, { data: "Value", header: true }],
        ["agent", intent.agent ?? "unknown"],
        ["scope", intent.scope.join(", ")],
        ["mutation_class", intent.mutation_class],
        ["max_files", String(intent.max_files)],
        ["allow_deletions", String(!!intent.allow_deletions)],
        ["allow_renames", String(!!intent.allow_renames)],
        ["allow_moves", String(!!intent.allow_moves)]
      ])
      .addHeading("Observed Mutations")
      .addParagraph(`Changed files: ${changedFiles.length}`)
      .addRaw(
        changedFiles
          .map(f => {
            const line =
              f.status === "renamed" && f.previous_filename
                ? `- [${f.status}] ${f.previous_filename} -> ${f.filename}`
                : `- [${f.status}] ${f.filename}`;
            return line;
          })
          .join("\n") + "\n\n"
      )
      .addHeading("Boundary Interpretation");

    if (violations.length === 0) {
      await core.summary.addParagraph("✅ No violations. Declared intent matches observed mutations.").write();
      core.info("No violations. Execution boundary interpretation passed.");
      return;
    }

    // Add violations to summary
    for (const v of violations) {
      await core.summary.addHeading(`Violation: ${v.rule}`, 3).addParagraph(v.message);
      if (v.items && v.items.length > 0) {
        await core.summary.addRaw(v.items.map(i => `- ${i}`).join("\n") + "\n\n");
      }
    }
    await core.summary.write();

    // Decide whether to fail build based on fail_on
    const failing = violations.filter(v => failOn.has(v.rule));
    if (failing.length > 0) {
      const msg =
        failing
          .map(v => {
            const items = v.items?.length ? `\n${v.items.map(i => `- ${i}`).join("\n")}` : "";
            return `[${v.rule}] ${v.message}${items}`;
          })
          .join("\n\n") || "Boundary interpretation failed.";
      core.setFailed(msg);
      return;
    }

    // Otherwise warn only
    for (const v of violations) {
      core.warning(`[${v.rule}] ${v.message}${v.items?.length ? " " + v.items.join(", ") : ""}`);
    }
    core.info("Violations present but not configured to fail the build (fail_on).");

  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

main();