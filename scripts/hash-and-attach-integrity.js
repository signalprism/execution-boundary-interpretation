#!/usr/bin/env node

/**
 * hash-and-attach-integrity.js
 *
 * Computes:
 *  - intent_hash = sha256(CANON_INTENT(INTENT.json))
 *  - diff_hash   = sha256(CANON_DIFF(diff.txt))
 *  - artifact_hash = sha256(CANON_ARTIFACT(artifact WITHOUT integrity))
 *
 * Writes updated artifact JSON with integrity block populated (signature fields placeholder).
 *
 * Zero deps. Deterministic. CI-native.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) out[k] = true;
    else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------- Canonicalization: JSON (same logic as scripts/canonicalize.js) ----------
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sortKeysRecursively(value) {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);
  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = {};
  for (const k of keys) out[k] = sortKeysRecursively(value[k]);
  return out;
}

function canonJsonBytesFromObject(obj) {
  const ordered = sortKeysRecursively(obj);
  const s = JSON.stringify(ordered);
  return Buffer.from(s, "utf8");
}

function canonJsonBytesFromFile(filePath) {
  const raw = fs.readFileSync(filePath);
  let obj;
  try {
    obj = JSON.parse(raw.toString("utf8"));
  } catch {
    die(`Invalid JSON: ${filePath}`);
  }
  return canonJsonBytesFromObject(obj);
}

// ---------- Canonicalization: Diff (same logic as scripts/canon-diff.js) ----------
function canonDiffBytesFromFile(filePath) {
  const raw = fs.readFileSync(filePath);
  let text = raw.toString("utf8");

  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = text.split("\n").map((line) => line.replace(/[ \t]+$/g, ""));
  text = lines.join("\n");

  if (text.length === 0) return Buffer.from("\n", "utf8");
  if (!text.endsWith("\n")) text += "\n";
  text = text.replace(/\n+$/g, "\n");

  return Buffer.from(text, "utf8");
}

// ---------- Artifact canonicalization excluding integrity ----------
function canonArtifactBytesExcludingIntegrity(artifactObj) {
  const clone = isPlainObject(artifactObj) ? { ...artifactObj } : artifactObj;
  if (isPlainObject(clone) && Object.prototype.hasOwnProperty.call(clone, "integrity")) {
    delete clone.integrity;
  }
  return canonJsonBytesFromObject(clone);
}

function nowIso() {
  return new Date().toISOString();
}

function main() {
  const args = parseArgs(process.argv);

  const artifactPath = args.artifact;
  const intentPath = args.intent;
  const diffPath = args.diff;
  const outPath = args.out;
  const ciRunId = args["ci-run-id"] || "";

  if (!artifactPath) die("Missing --artifact <meaning.json>");
  if (!intentPath) die("Missing --intent <INTENT.json>");
  if (!diffPath) die("Missing --diff <diff.txt>");
  if (!outPath) die("Missing --out <output.json>");

  // Load artifact
  let artifactObj;
  try {
    artifactObj = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  } catch {
    die(`Invalid JSON artifact: ${artifactPath}`);
  }

  // Compute hashes
  const canonIntent = canonJsonBytesFromFile(intentPath);
  const canonDiff = canonDiffBytesFromFile(diffPath);
  const canonArtifact = canonArtifactBytesExcludingIntegrity(artifactObj);

  const intentHash = sha256Hex(canonIntent);
  const diffHash = sha256Hex(canonDiff);
  const artifactHash = sha256Hex(canonArtifact);

  // If artifact has boundary.diff_hash, enforce it matches computed diffHash (recommended)
  if (artifactObj.boundary && artifactObj.boundary.diff_hash) {
    const bd = String(artifactObj.boundary.diff_hash).toLowerCase();
    const computed = diffHash.toLowerCase();
    if (bd !== computed) {
      die(`boundary.diff_hash (${bd}) does not match computed diff_hash (${computed}).`);
    }
  }

  // Attach/overwrite integrity (signature to be filled by signer)
  artifactObj.integrity = {
    canonicalization: "sp.canonicalization.v1",
    hash_algorithm: "sha256",
    artifact_hash: artifactHash,
    intent_hash: intentHash,
    diff_hash: diffHash,

    // Signer will fill these:
    signature: artifactObj.integrity?.signature || "",
    signature_format: artifactObj.integrity?.signature_format || "unknown",
    signing_key_id: artifactObj.integrity?.signing_key_id || "",
    ci_run_id: String(ciRunId || artifactObj.integrity?.ci_run_id || ""),
    timestamp: artifactObj.integrity?.timestamp || nowIso()
  };

  fs.writeFileSync(outPath, JSON.stringify(artifactObj, null, 2) + "\n", "utf8");

  console.log("OK: integrity hashes computed and attached.");
  console.log(`- intent_hash   = ${intentHash}`);
  console.log(`- diff_hash     = ${diffHash}`);
  console.log(`- artifact_hash = ${artifactHash}`);
  console.log(`Wrote: ${outPath}`);
}

main();
