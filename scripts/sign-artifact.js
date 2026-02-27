#!/usr/bin/env node

/**
 * sign-artifact.js
 *
 * Signs the canonical bytes of the artifact (excluding top-level integrity),
 * emits a detached signature file, and embeds the signature into artifact.integrity.
 *
 * Zero Node deps; uses system gpg for signing.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

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

function canonArtifactBytesExcludingIntegrity(artifactObj) {
  const clone = isPlainObject(artifactObj) ? { ...artifactObj } : artifactObj;
  if (isPlainObject(clone) && Object.prototype.hasOwnProperty.call(clone, "integrity")) {
    delete clone.integrity;
  }
  const ordered = sortKeysRecursively(clone);
  const s = JSON.stringify(ordered);
  return Buffer.from(s, "utf8");
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    const out = (res.stderr || res.stdout || "").trim();
    die(`${cmd} failed: ${out || "unknown error"}`);
  }
  return res;
}

function main() {
  const args = parseArgs(process.argv);

  const artifactPath = args.artifact;
  const outPath = args.out;
  const sigOut = args["sig-out"];
  const pubkeyOut = args["pubkey-out"];
  const gpgFpr = args["gpg-fpr"]; // fingerprint or key id (recommended fingerprint)

  if (!artifactPath) die("Missing --artifact <meaning.with-integrity.json>");
  if (!outPath) die("Missing --out <meaning.signed.json>");
  if (!sigOut) die("Missing --sig-out <artifact.sig>");
  if (!gpgFpr) die("Missing --gpg-fpr <fingerprint or key id>");

  let artifactObj;
  try {
    artifactObj = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  } catch {
    die(`Invalid JSON artifact: ${artifactPath}`);
  }

  if (!artifactObj.integrity) die("Artifact missing integrity block (run hash-and-attach-integrity.js first).");

  // Canonical bytes to sign (excluding integrity)
  const canonBytes = canonArtifactBytesExcludingIntegrity(artifactObj);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-sign-"));
  const canonPath = path.join(tmpDir, "artifact.canon.json");
  fs.writeFileSync(canonPath, canonBytes);

  // Detached signature (binary) for gpg --verify
  // If you prefer ASCII armored, add: --armor
  run("gpg", [
    "--batch",
    "--yes",
    "--local-user",
    gpgFpr,
    "--output",
    sigOut,
    "--detach-sign",
    canonPath
  ]);

  // Export pubkey (optional but useful for bundling verification materials)
  if (pubkeyOut) {
    run("gpg", ["--batch", "--yes", "--output", pubkeyOut, "--armor", "--export", gpgFpr]);
  }

  // Embed signature into artifact.integrity as base64 (compact, deterministic)
  const sigBytes = fs.readFileSync(sigOut);
  artifactObj.integrity.signature = sigBytes.toString("base64");
  artifactObj.integrity.signature_format = "gpg-detached-base64";
  artifactObj.integrity.signing_key_id = String(gpgFpr);

  // Keep timestamp if already set; otherwise set now
  if (!artifactObj.integrity.timestamp) artifactObj.integrity.timestamp = new Date().toISOString();

  fs.writeFileSync(outPath, JSON.stringify(artifactObj, null, 2) + "\n", "utf8");

  // Best-effort cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log("OK: artifact signed and signature embedded.");
  console.log(`Wrote: ${outPath}`);
  console.log(`Signature (detached): ${sigOut}`);
  if (pubkeyOut) console.log(`Public key: ${pubkeyOut}`);
}

main();
