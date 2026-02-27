#!/usr/bin/env node

/**
 * sp.canonicalization.v1 — JSON canonicalization
 *
 * Rules:
 * - Strict JSON parse
 * - Object keys sorted lexicographically (Unicode code point order)
 * - Arrays preserved in original order
 * - No insignificant whitespace
 * - UTF-8 output
 * - No trailing newline
 */

const fs = require("fs");

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(2);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sortKeysRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sortedKeys = Object.keys(value).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );

  const result = {};
  for (const key of sortedKeys) {
    result[key] = sortKeysRecursively(value[key]);
  }
  return result;
}

function canonicalizeJsonBuffer(buf) {
  let parsed;

  try {
    parsed = JSON.parse(buf.toString("utf8"));
  } catch {
    die("Invalid JSON input. Strict JSON required.");
  }

  const ordered = sortKeysRecursively(parsed);

  const canonicalString = JSON.stringify(ordered);

  return Buffer.from(canonicalString, "utf8");
}

function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    die("Usage: node canonicalize.js <input.json>");
  }

  let input;
  try {
    input = fs.readFileSync(inputPath);
  } catch {
    die(`Cannot read file: ${inputPath}`);
  }

  const output = canonicalizeJsonBuffer(input);

  process.stdout.write(output);
}

main();
