const { execSync } = require("child_process");
const { normalizeSlashes } = require("./io");

function getBaseRef() {
  return (process.env.GITHUB_BASE_REF && process.env.GITHUB_BASE_REF.trim()) || "main";
}

function fetchBase(baseRef) {
  try {
    execSync(`git fetch --no-tags --prune --depth=200 origin ${baseRef}`, { stdio: "ignore" });
  } catch {
    // best-effort
  }
}

function computeDiffSummary() {
  const baseRef = getBaseRef();
  fetchBase(baseRef);

  let mergeBase;
  try {
    mergeBase = execSync(`git merge-base HEAD origin/${baseRef}`, { encoding: "utf8" }).trim();
  } catch {
    mergeBase = `origin/${baseRef}`;
  }

  const nameStatus = execSync(`git diff --name-status ${mergeBase}...HEAD`, { encoding: "utf8" });
  const changed_paths = [];
  let files_added = 0, files_modified = 0, files_deleted = 0;

  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const parts = line.split("\t").filter(Boolean);
    const status = parts[0];

    if (status.startsWith("R")) {
      const newPath = parts[2];
      changed_paths.push({ path: normalizeSlashes(newPath), status: "R" });
      files_modified++;
      continue;
    }

    const p = parts[1];
    changed_paths.push({ path: normalizeSlashes(p), status });
    if (status === "A") files_added++;
    else if (status === "M") files_modified++;
    else if (status === "D") files_deleted++;
    else files_modified++;
  }

  const numstat = execSync(`git diff --numstat ${mergeBase}...HEAD`, { encoding: "utf8" });
  let total_loc_added = 0, total_loc_deleted = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [a, d] = line.split("\t");
    if (a && a !== "-") total_loc_added += parseInt(a, 10) || 0;
    if (d && d !== "-") total_loc_deleted += parseInt(d, 10) || 0;
  }

  const top = new Set();
  for (const cp of changed_paths) {
    if (cp.status === "A") {
      const seg = cp.path.split("/")[0];
      if (seg) top.add(seg);
    }
  }

  return {
    baseRef,
    mergeBase,
    changed_paths,
    files_added,
    files_modified,
    files_deleted,
    total_loc_added,
    total_loc_deleted,
    new_top_level_dirs: top.size
  };
}

module.exports = { computeDiffSummary };
