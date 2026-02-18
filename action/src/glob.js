function normalizeSlashes(p) {
  return String(p || "").replace(/\\/g, "/");
}

function globToRegExp(glob) {
  let s = String(glob || "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
  s = s.replace(/\\\*\\\*/g, "§§DOUBLESTAR§§");
  s = s.replace(/\\\*/g, "[^/]*");
  s = s.replace(/§§DOUBLESTAR§§/g, ".*");
  s = s.replace(/\\\?/g, "[^/]");
  return new RegExp("^" + s + "$");
}

function matchesAnyPath(filePath, globs) {
  if (!globs || !globs.length) return false;
  const p = normalizeSlashes(filePath);
  for (const g of globs) {
    if (globToRegExp(g).test(p)) return true;
  }
  return false;
}

function getExt(p) {
  const idx = String(p || "").lastIndexOf(".");
  return idx >= 0 ? String(p).slice(idx).toLowerCase() : "";
}

function matchesAnyExtension(filePath, exts) {
  if (!exts || !exts.length) return false;
  const ext = getExt(filePath);
  return exts.map(e => String(e).toLowerCase()).includes(ext);
}

module.exports = { matchesAnyPath, matchesAnyExtension };
