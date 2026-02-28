/**
 * verify-authority-contract.js
 *
 * CI/Offline verifier for Authority Contract v1.1 integrity binding.
 *
 * Goals:
 * - No SaaS / no network
 * - Minimal surface area
 * - Deterministic verification
 *
 * Verifies:
 *  1) CANON + sha256 of INTENT.json matches integrity.intent_hash
 *  2) CANON + sha256 of diff text matches integrity.diff_hash
 *  3) CANON (excluding integrity) + sha256 matches integrity.artifact_hash
 *  4) Detached signature verifies over canonical bytes (excluding integrity)
 *  5) Optional: boundary.diff_hash equals integrity.diff_hash
 *
 * Usage:
 *   node verify-authority-contract.js \
 *     --contract ./meaning.json \
 *     --intent ./INTENT.json \
 *     --diff ./diff.txt \
 *     --sig ./artifact.sig \
 *     --pubkey ./pubkey.asc
 *
 * Notes:
 * - Signature verification implemented via `gpg` if available.
 * - If `--sig` omitted, verifier will try to use contract.integrity.signature
 *   only if it looks like an inline ASCII-armored signature.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

// -------------------------
// CLI parsing (tiny, no deps)
// -------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(msg, code = 2) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function readFileOrDie(p, label) {
  try {
    return fs.readFileSync(p);
  } catch (e) {
    die(`Failed to read ${label}: ${p}`);
  }
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// -------------------------
// Canonicalization: JSON (sp.canonicalization.v1)
// -------------------------
//
// Rules implemented:
// - Parse strict JSON
// - Sort object keys lexicographically by Unicode code point (JS default string compare is Unicode code units)
// - Preserve arrays
// - Serialize without whitespace via JSON.stringify on ordered structure
// - UTF-8 bytes, no trailing newline
//
function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function sortKeysRecursively(value) {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);
  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = {};
  for (const k of keys) out[k] = sortKeysRecursively(value[k]);
  return out;
}

function canonJsonBytes(jsonBytes) {
  let obj;
  try {
    obj = JSON.parse(jsonBytes.toString("utf8"));
  } catch (e) {
    die("Invalid JSON input (strict JSON required).");
  }
  const ordered = sortKeysRecursively(obj);
  const s = JSON.stringify(ordered); // no whitespace by default
  return Buffer.from(s, "utf8");
}

// Canonical artifact excludes top-level `integrity`
function canonArtifactBytes(contractJsonBytes) {
  let obj;
  try {
    obj = JSON.parse(contractJsonBytes.toString("utf8"));
  } catch {
    die("Invalid contract JSON.");
  }
  if (isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, "integrity")) {
    const clone = { ...obj };
    delete clone.integrity;
    const ordered = sortKeysRecursively(clone);
    const s = JSON.stringify(ordered);
    return Buffer.from(s, "utf8");
  }
  // If no integrity, canonicalize as-is (caller should fail on missing field separately)
  const ordered = sortKeysRecursively(obj);
  const s = JSON.stringify(ordered);
  return Buffer.from(s, "utf8");
}

// -------------------------
// Canonicalization: Diff (sp.canonicalization.v1)
// -------------------------
//
// Rules implemented:
// - Convert CRLF and CR to LF
// - Strip trailing spaces/tabs per line
// - Ensure exactly one final LF; if empty, output single LF
//
function canonDiffBytes(diffBytes) {
  let s = diffBytes.toString("utf8");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // remove trailing spaces/tabs on each line
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  // ensure exactly one final LF
  if (s.length === 0) return Buffer.from("\n", "utf8");
  if (!s.endsWith("\n")) s = s + "\n";
  // collapse multiple trailing newlines to exactly one? (spec says end with a single LF)
  s = s.replace(/\n+$/g, "\n");
  return Buffer.from(s, "utf8");
}

// -------------------------
// Signature verification (GPG)
// -------------------------
function haveCmd(cmd) {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return which.status === 0;
}

function verifyWithGpg({ pubkeyPath, sigPath, dataPath }) {
  if (!haveCmd("gpg")) {
    return { ok: false, reason: "gpg not found on PATH" };
  }

  // Use a temp GNUPGHOME to avoid touching user's keychain.
  const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "sp-gpg-"));
  const env = { ...process.env, GNUPGHOME: tmpDir };

  // Import pubkey
  const imp = spawnSync("gpg", ["--batch", "--yes", "--import", pubkeyPath], {
    encoding: "utf8",
    env,
  });
  if (imp.status !== 0) {
    return { ok: false, reason: `gpg import failed: ${imp.stderr || imp.stdout}` };
  }

  // Verify detached signature: gpg --verify sig data
  const ver = spawnSync("gpg", ["--batch", "--verify", sigPath, dataPath], {
    encoding: "utf8",
    env,
  });

  // Clean up temp GNUPGHOME best-effort
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  if (ver.status !== 0) {
    return { ok: false, reason: `gpg verify failed: ${ver.stderr || ver.stdout}` };
  }
  return { ok: true };
}

// -------------------------
// Main
// -------------------------
function main() {
  const args = parseArgs(process.argv);

  const contractPath = args.contract;
  const intentPath = args.intent;
  const diffPath = args.diff;

  if (!contractPath) die("Missing --contract <path-to-authority-contract-json>");
  if (!intentPath) die("Missing --intent <path-to-INTENT.json>");
  if (!diffPath) die("Missing --diff <path-to-diff.txt>");

  const contractBytes = readFileOrDie(contractPath, "contract");
  const intentBytes = readFileOrDie(intentPath, "intent");
  const diffBytes = readFileOrDie(diffPath, "diff");

  let contract;
  try {
    contract = JSON.parse(contractBytes.toString("utf8"));
  } catch {
    die("Contract is not valid JSON.");
  }

  // Basic structure checks (Authority Contract v1.1)
  if (contract.contract_version !== "sp.authority_contract.v1.1") {
    die(`contract_version mismatch. Expected "sp.authority_contract.v1.1" but got "${contract.contract_version}"`);
  }
  if (!contract.integrity) die("Missing required top-level integrity block.");

  const integ = contract.integrity;

  // Required integrity fields (minimal)
  const req = ["canonicalization", "hash_algorithm", "artifact_hash", "intent_hash", "diff_hash", "signature", "signing_key_id", "timestamp"];
  for (const k of req) {
    if (integ[k] === undefined || integ[k] === null || integ[k] === "") die(`Missing integrity.${k}`);
  }
  if (integ.canonicalization !== "sp.canonicalization.v1") {
    die(`Unsupported canonicalization: ${integ.canonicalization}`);
  }
  if (integ.hash_algorithm !== "sha256") {
    die(`Unsupported hash_algorithm: ${integ.hash_algorithm}`);
  }

  // 1) intent_hash
  const canonIntent = canonJsonBytes(intentBytes);
  const intentHash = sha256Hex(canonIntent);

  // 2) diff_hash
  const canonDiff = canonDiffBytes(diffBytes);
  const diffHash = sha256Hex(canonDiff);

  // 3) artifact_hash (exclude integrity)
  const canonArtifact = canonArtifactBytes(contractBytes);
  const artifactHash = sha256Hex(canonArtifact);

  // Optional: boundary.diff_hash must match integrity.diff_hash if boundary present
  if (contract.boundary && contract.boundary.diff_hash) {
    const bd = String(contract.boundary.diff_hash).toLowerCase();
    const id = String(integ.diff_hash).toLowerCase();
    if (bd !== id) {
      die(`boundary.diff_hash (${bd}) does not match integrity.diff_hash (${id}).`);
    }
  }

  // Compare hashes (case-insensitive)
  function eqHex(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  if (!eqHex(intentHash, integ.intent_hash)) {
    die(`intent_hash mismatch. computed=${intentHash} expected=${integ.intent_hash}`);
  }
  if (!eqHex(diffHash, integ.diff_hash)) {
    die(`diff_hash mismatch. computed=${diffHash} expected=${integ.diff_hash}`);
  }
  if (!eqHex(artifactHash, integ.artifact_hash)) {
    die(`artifact_hash mismatch. computed=${artifactHash} expected=${integ.artifact_hash}`);
  }

  // 4) signature verification (detached signature over canonical artifact bytes)
  // Write canonical artifact bytes to temp file for gpg verify.
  const os = require("os");
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "sp-verify-"));
  const dataPath = path.join(tmpBase, "artifact.canon.json");
  fs.writeFileSync(dataPath, canonArtifact);

  // Signature source:
  // - Prefer --sig file if provided
  // - Else attempt to interpret integrity.signature as ASCII-armored and write it
  let sigPath = args.sig ? path.resolve(args.sig) : null;
  if (!sigPath) {
    const sigText = String(integ.signature);
    // Heuristic: looks like ASCII-armored PGP signature
    if (sigText.includes("BEGIN PGP SIGNATURE")) {
      sigPath = path.join(tmpBase, "artifact.sig.asc");
      fs.writeFileSync(sigPath, sigText, "utf8");
    } else {
      // If user stored base64 in integrity.signature, we can't infer format safely without signature_format.
      // If signature_format indicates base64, decode.
      if (integ.signature_format && integ.signature_format.includes("base64")) {
        sigPath = path.join(tmpBase, "artifact.sig");
        fs.writeFileSync(sigPath, Buffer.from(sigText, "base64"));
      } else {
        die("No --sig provided and integrity.signature is not ASCII-armored. Provide --sig or set integrity.signature_format to a base64 type.");
      }
    }
  }

  const pubkeyPath = args.pubkey ? path.resolve(args.pubkey) : null;
  if (!pubkeyPath) {
    die("Missing --pubkey <path-to-public-key>. (Offline verification requires a trust anchor.)");
  }

  const sigRes = verifyWithGpg({ pubkeyPath, sigPath, dataPath });
  // cleanup temp
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {}

  if (!sigRes.ok) {
    die(`Signature verification failed: ${sigRes.reason}`);
  }

  // Success
  console.log("OK: Authority Contract v1.1 verification succeeded.");
  console.log(`- intent_hash   = ${intentHash}`);
  console.log(`- diff_hash     = ${diffHash}`);
  console.log(`- artifact_hash = ${artifactHash}`);
  process.exit(0);
}

main();
