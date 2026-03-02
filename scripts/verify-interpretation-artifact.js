#!/usr/bin/env node
/**
 * Verify a signed sp.interpretation_artifact.v2.1.
 *
 * Authority-first variant (Run 4 finalization):
 * - Recomputes:
 *   - authority_hash = sha256( canonicalize(AUTHORITY.json) )
 *   - diff_hash      = sha256( canon-diff(diff.txt) )
 *   - artifact_hash  = sha256( canonicalize(artifact WITHOUT top-level integrity) )
 * - Verifies signature:
 *   - signature is base64 of detached signature bytes over canonical payload above
 *   - uses provided pubkey (ASCII-armored) imported into ephemeral GNUPGHOME
 *
 * Exit codes:
 *   0 = OK
 *   2 = verification failed
 *
 * Compatibility:
 * - If --allow-intent-hash is provided, will accept legacy integrity.intent_hash
 *   and --intent argument (deprecated). Prefer authority_hash + --authority.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

function die(msg, code = 2) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function readJson(p) {
  return JSON.parse(readText(p));
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * Canonicalize per sp.canonicalization.v1:
 * - recursively sort object keys lexicographically
 * - arrays preserve order
 * - JSON.stringify with no whitespace
 * - UTF-8 bytes are the payload
 */
function canonicalizeToString(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeToString(v)).join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    const inner = keys
      .map((k) => `${JSON.stringify(k)}:${canonicalizeToString(value[k])}`)
      .join(",");
    return `{${inner}}`;
  }
  return JSON.stringify(value);
}

/**
 * Diff canonicalization:
 * We defer to your existing script (zero-deps) if present:
 *   node scripts/canon-diff.js diff.txt
 * If not present, we fall back to raw bytes of diff file.
 */
function canonicalizeDiffBytes(diffPath) {
  const canonDiffPath = path.join(process.cwd(), "scripts", "canon-diff.js");
  if (fs.existsSync(canonDiffPath)) {
    const r = spawnSync(process.execPath, [canonDiffPath, diffPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status !== 0) {
      die(`canon-diff.js failed: ${r.stderr || "(no stderr)"}`);
    }
    return Buffer.from(r.stdout, "utf8");
  }
  return fs.readFileSync(diffPath);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--artifact") out.artifact = argv[++i];
    else if (a === "--authority") out.authority = argv[++i];
    else if (a === "--diff") out.diff = argv[++i];
    else if (a === "--pubkey") out.pubkey = argv[++i];

    // legacy (deprecated)
    else if (a === "--intent") out.intent = argv[++i];
    else if (a === "--allow-intent-hash") out.allowIntentHash = true;

    else if (a === "--allow-schema-prefix") out.allowSchemaPrefix = true;
    else die(`Unknown arg: ${a}`);
  }

  // required
  for (const k of ["artifact", "diff", "pubkey"]) {
    if (!out[k]) die(`Missing required arg: --${k}`);
  }

  // authority required unless legacy flag + legacy arg provided
  if (!out.authority) {
    if (out.allowIntentHash && out.intent) {
      // ok (legacy)
    } else {
      die(`Missing required arg: --authority (or use --allow-intent-hash with --intent for legacy artifacts)`);
    }
  }

  return out;
}

function run() {
  const args = parseArgs(process.argv);

  const artifact = readJson(args.artifact);

  // 1) Basic type checks
  if (!artifact || typeof artifact !== "object") die("artifact is not a JSON object");
  const allowedSchemas = new Set([
    "sp.interpretation_artifact.v2.1",
    "sp.gate.meaning_artifact.v0",
  ]);

  if (!allowedSchemas.has(artifact.schema)) {
    die(
      `schema mismatch. Expected one of [${Array.from(allowedSchemas).join(", ")}] but got "${artifact.schema}"`
    );
  }

  const integrity = artifact.integrity;
  if (integrity.canonicalization !== "sp.canonicalization.v1") {
    die(`canonicalization mismatch. Expected "sp.canonicalization.v1" but got "${integrity.canonicalization}"`);
  }
  if (integrity.hash_algorithm !== "sha256") {
    die(`hash_algorithm mismatch. Expected "sha256" but got "${integrity.hash_algorithm}"`);
  }
  if (integrity.signature_format !== "gpg-detached-base64") {
    die(`signature_format mismatch. Expected "gpg-detached-base64" but got "${integrity.signature_format}"`);
  }
  if (typeof integrity.signature !== "string" || integrity.signature.length < 20) {
    die("integrity.signature missing/invalid");
  }
  if (typeof integrity.signing_key_id !== "string" || integrity.signing_key_id.length < 16) {
    die("integrity.signing_key_id missing/invalid");
  }

  // 2) Recompute authority_hash (preferred) or intent_hash (legacy)
  const expectsAuthority = typeof integrity.authority_hash === "string" && integrity.authority_hash.length === 64;

  if (expectsAuthority) {
    if (!args.authority) die("artifact expects authority_hash but --authority was not provided");
    const authorityObj = readJson(args.authority);
    const authorityCanonStr = canonicalizeToString(authorityObj);
    const authorityHash = sha256Hex(Buffer.from(authorityCanonStr, "utf8"));
    if (authorityHash !== integrity.authority_hash) {
      die(`authority_hash mismatch.\n  expected: ${integrity.authority_hash}\n  computed: ${authorityHash}`);
    }
  } else {
    // Legacy: integrity.intent_hash
    if (!args.allowIntentHash) {
      die(
        `artifact missing integrity.authority_hash. Refusing legacy intent_hash verification without --allow-intent-hash`
      );
    }
    if (!integrity.intent_hash || typeof integrity.intent_hash !== "string") {
      die("legacy mode requested but integrity.intent_hash missing/invalid");
    }
    if (!args.intent) die("legacy mode requested but --intent was not provided");
    const intentObj = readJson(args.intent);
    const intentCanonStr = canonicalizeToString(intentObj);
    const intentHash = sha256Hex(Buffer.from(intentCanonStr, "utf8"));
    if (intentHash !== integrity.intent_hash) {
      die(`intent_hash mismatch.\n  expected: ${integrity.intent_hash}\n  computed: ${intentHash}`);
    }
    console.error("WARN: Verified legacy integrity.intent_hash. Migrate to integrity.authority_hash + --authority.");
  }

  // 3) Recompute diff_hash
  const diffCanonBytes = canonicalizeDiffBytes(args.diff);
  const diffHash = sha256Hex(diffCanonBytes);
  if (diffHash !== integrity.diff_hash) {
    die(`diff_hash mismatch.\n  expected: ${integrity.diff_hash}\n  computed: ${diffHash}`);
  }

  // 4) Recompute artifact_hash over payload = artifact minus top-level integrity
  const payloadObj = { ...artifact };
  delete payloadObj.integrity;

  const payloadCanonStr = canonicalizeToString(payloadObj);
  const artifactHash = sha256Hex(Buffer.from(payloadCanonStr, "utf8"));
  if (artifactHash !== integrity.artifact_hash) {
    die(`artifact_hash mismatch.\n  expected: ${integrity.artifact_hash}\n  computed: ${artifactHash}`);
  }

  // 5) Verify signature with ephemeral GNUPGHOME
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-verify-"));
  const gnupgHome = path.join(tmpDir, "gnupg");
  fs.mkdirSync(gnupgHome, { recursive: true, mode: 0o700 });

  const payloadPath = path.join(tmpDir, "payload.canon.json");
  const sigPath = path.join(tmpDir, "artifact.sig");
  const pubkeyPath = path.join(tmpDir, "pubkey.asc");

  fs.writeFileSync(payloadPath, payloadCanonStr, "utf8");
  fs.writeFileSync(sigPath, Buffer.from(integrity.signature, "base64"));
  fs.writeFileSync(pubkeyPath, readText(args.pubkey), "utf8");

  const env = { ...process.env, GNUPGHOME: gnupgHome };

  // import pubkey
  {
    const r = spawnSync("gpg", ["--batch", "--yes", "--import", pubkeyPath], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status !== 0) {
      die(`gpg import failed: ${r.stderr || "(no stderr)"}`);
    }
  }

  // ensure signing_key_id matches imported key fingerprint
  {
    const r = spawnSync("gpg", ["--batch", "--with-colons", "--fingerprint"], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status !== 0) {
      die(`gpg fingerprint failed: ${r.stderr || "(no stderr)"}`);
    }
    const fprs = r.stdout
      .split("\n")
      .filter((l) => l.startsWith("fpr:"))
      .map((l) => l.split(":")[9])
      .filter(Boolean);

    if (!fprs.some((f) => f.toUpperCase() === String(integrity.signing_key_id).toUpperCase())) {
      die(
        `signing_key_id not found in imported pubkey.\n  signing_key_id: ${integrity.signing_key_id}\n  imported: ${fprs.join(", ")}`
      );
    }
  }

  // verify detached signature against payload
  {
    const r = spawnSync("gpg", ["--batch", "--verify", sigPath, payloadPath], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status !== 0) {
      die(`signature verification failed: ${r.stderr || r.stdout || "(no output)"}`);
    }
  }

  console.log("OK: Signed interpretation artifact verification succeeded.");
  console.log(`- schema         = ${artifact.schema}`);
  console.log(`- signing_key_id = ${integrity.signing_key_id}`);
  console.log(`- artifact_hash  = ${integrity.artifact_hash}`);
  if (integrity.authority_hash) console.log(`- authority_hash = ${integrity.authority_hash}`);
  if (integrity.intent_hash) console.log(`- intent_hash    = ${integrity.intent_hash}`);
  console.log(`- diff_hash      = ${integrity.diff_hash}`);
  process.exit(0);
}

run();
