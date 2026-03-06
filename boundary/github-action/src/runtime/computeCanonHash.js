const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const EXCLUDE = new Set([
  "artifacts/bundle.index.json",
  "artifacts/checksums.sha256",
]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function shouldExclude(relPosix) {
  if (EXCLUDE.has(relPosix)) return true;
  if (relPosix.startsWith("artifacts/signatures/")) return true;
  if (relPosix.includes("/.git/") || relPosix.startsWith(".git/")) return true;
  if (relPosix.endsWith("/.DS_Store") || relPosix.endsWith("Thumbs.db")) return true;
  return false;
}

function walkFiles(rootDir) {
  const out = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile()) {
        const rel = toPosix(path.relative(rootDir, abs));
        if (!shouldExclude(rel)) out.push({ abs, rel });
      }
    }
  }

  walk(rootDir);
  out.sort((a, b) => Buffer.from(a.rel).compare(Buffer.from(b.rel)));
  return out;
}

function sha256File(absPath) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(absPath));
  return h.digest("hex");
}

function sortKeysDeep(x) {
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  if (x && typeof x === "object") {
    const keys = Object.keys(x).sort();
    const o = {};
    for (const k of keys) o[k] = sortKeysDeep(x[k]);
    return o;
  }
  return x;
}

function canonicalJsonBytes(obj) {
  const sorted = sortKeysDeep(obj);
  return Buffer.from(JSON.stringify(sorted), "utf8");
}

function computeCanonHashFromDisk(bundleRoot, canonId, canonVersion) {
  const files = walkFiles(bundleRoot).map(({ abs, rel }) => ({
    path: rel,
    sha256: sha256File(abs),
  }));

  const hashPayload = {
    schema: "sp.canon_index.v1",
    canon_id: canonId,
    canon_version: canonVersion,
    files,
  };

  const canonHash =
    "sha256:" +
    crypto.createHash("sha256").update(canonicalJsonBytes(hashPayload)).digest("hex");

  return { hashPayload, canonHash, files };
}

function verifyCanonHashAgainstDisk(bundleRoot, canonId, canonVersion, bundleIndex) {
  if (!bundleIndex) return { ok: false, reason: "bundle.index.json missing" };

  const expected = bundleIndex?.computed?.canon_hash;
  if (!expected || typeof expected !== "string") {
    return { ok: false, reason: "bundle.index.json missing computed.canon_hash" };
  }

  const { canonHash } = computeCanonHashFromDisk(bundleRoot, canonId, canonVersion);

  if (canonHash !== expected) {
    return {
      ok: false,
      reason: `canon_hash mismatch: index=${expected} recomputed=${canonHash}`,
    };
  }

  return { ok: true, canonHash };
}

module.exports = {
  computeCanonHashFromDisk,
  verifyCanonHashAgainstDisk,
};
