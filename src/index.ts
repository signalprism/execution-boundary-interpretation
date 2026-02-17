import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "fs";
import Ajv from "ajv";

type MutationClass = "patch" | "refactor" | "rename" | "delete";

type Intent = {
  agent?: string;
  scope: string[];
  mutation_class: MutationClass;
  max_files: number;
  allow_deletions?: boolean;
  allow_renames?: boolean;
  allow_moves?: boolean;
};

type ChangedFile = {
  filename: string;
  status: string;
  previous_filename?: string;
};

const INTENT_SCHEMA = {
  type: "object",
  required: ["scope", "mutation_class", "max_files"],
  additionalProperties: true,
  properties: {
    agent: { type: "string" },
    scope: { type: "array", items: { type: "string" }, minItems: 1 },
    mutation_class: { type: "string", enum: ["patch", "refactor", "rename", "delete"] },
    max_files: { type: "integer", minimum: 1 },
    allow_deletions: { type: "boolean" },
    allow_renames: { type: "boolean" },
    allow_moves: { type: "boolean" }
  }
};

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

    const pr = github.context.payload.pull_request;
    if (!pr) {
      core.info("No pull_request in event payload. Skipping.");
      return;
    }

    if (!fs.existsSync(intentPath)) {
      core.setFailed(`Intent file not found at ${intentPath}.`);
      return;
    }

    let intentRaw: Record<string, any>;
    try {
      intentRaw = JSON.parse(fs.readFileSync(intentPath, "utf8")) as Record<string, any>;
    } catch {
      core.setFailed(`Failed to parse ${intentPath} as JSON.`);
      return;
    }

    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(INTENT_SCHEMA);

    const valid = validate(intentRaw as any);
    if (!valid) {
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
      core.setFailed("GITHUB_TOKEN not available.");
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const prNumber = pr.number;

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

    const violations: { rule: string; message: string; items?: string[] }[] = [];

    // file_count
    if (changedFiles.length > intent.max_files) {
      violations.push({
        rule: "file_count",
        message: `File count exceeded: ${changedFiles.length} > ${intent.max_files}`
      });
    }

    // scope
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
      const allowed = intent.allow_renames || intent.mutation_class === "rename";
      if (!allowed) {
        violations.push({
          rule: "renames",
          message: "Renames detected but not declared.",
          items: renames.map(fmtRename)
        });
      }
    }

    // moves
    const moves = renames.filter(r => {
      const prevDir = dirPrefix(r.previous_filename!);
      const nextDir = dirPrefix(r.filename);
      return prevDir !== nextDir;
    });

    if (moves.length > 0) {
      const allowed = intent.allow_moves || intent.mutation_class === "rename";
      if (!allowed) {
        violations.push({
          rule: "moves",
          message: "Moves detected but not declared.",
          items: moves.map(fmtRename)
        });
      }
    }

    // Summary Output
    await core.summary
      .addHeading("Execution Boundary Interpretation")
      .addRaw("Declared intent interpreted against actual PR mutations.\n\n")
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
      .addRaw(`Changed files: ${changedFiles.length}\n\n`)
      .addRaw(
        changedFiles
          .map(f =>
            f.status === "renamed" && f.previous_filename
              ? `- [${f.status}] ${f.previous_filename} -> ${f.filename}`
              : `- [${f.status}] ${f.filename}`
          )
          .join("\n") + "\n\n"
      )
      .addHeading("Boundary Interpretation");

    if (violations.length === 0) {
      await core.summary
        .addRaw("✅ No violations. Declared intent matches observed mutations.\n\n")
        .write();
      return;
    }

    for (const v of violations) {
      await core.summary
        .addHeading(`Violation: ${v.rule}`, 3)
        .addRaw(`${v.message}\n\n`);

      if (v.items && v.items.length > 0) {
        await core.summary.addRaw(v.items.map(i => `- ${i}`).join("\n") + "\n\n");
      }
    }

    await core.summary.write();

    const failing = violations.filter(v => failOn.has(v.rule));
    if (failing.length > 0) {
      core.setFailed(
        failing
          .map(v => `[${v.rule}] ${v.message}`)
          .join("\n")
      );
      return;
    }

  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

main();
