#!/usr/bin/env node

/**
 * sp.canonicalization.v1 — Diff canonicalization
 *
 * Rules:
 * - Convert CRLF and CR to LF
 * - Strip trailing spaces and tabs per line
 * - Ensure exactly one final LF
 * - If empty, output exactly one LF
 */

const fs = require("fs");

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(2);
}

function canonicalizeDiffBuffer(buf) {
  let text = buf.toString("utf8");

  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Strip trailing spaces and tabs per line
  const lines = text.split("\n").map(line =>
    line.replace(/[ \t]+$/g, "")
  );

  text = lines.join("\n");

  // Ensure exactly one final LF
  if (text.length === 0) {
    return Buffer.from("\n", "utf8");
  }

  if (!text.endsWith("\n")) {
    text += "\n";
  }

  // Collapse multiple trailing newlines into one
  text = text.replace(/\n+$/g, "\n");

  return Buffer.from(text, "utf8");
}

function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    die("Usage: node canon-diff.js <diff.txt>");
  }

  let input;
  try {
    input = fs.readFileSync(inputPath);
  } catch {
    die(`Cannot read file: ${inputPath}`);
  }

  const output = canonicalizeDiffBuffer(input);

  process.stdout.write(output);
}

main();
