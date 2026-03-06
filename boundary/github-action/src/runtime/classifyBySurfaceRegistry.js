/**
 * Deterministic classifier driven by surface_registry.yaml
 *
 * registry expects:
 *  - authority_order: ["low","medium","high","critical"]
 *  - action_classes: { <classId>: { min_authority, match: { any_paths?, any_extensions?, heuristics? } } }
 *
 * ctx:
 *  - files_changed: string[]
 *  - stats?: { files_added?: number, total_loc_added?: number, new_top_level_dirs?: number }
 */

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Supports simple glob subset: **, *, ?
function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, "/");
  let re = "^";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      continue;
    }
    re += escapeRegex(ch);
  }
  re += "$";
  return new RegExp(re);
}

function anyPathMatches(patterns, files) {
  if (!patterns || patterns.length === 0) return false;
  const regs = patterns.map(globToRegExp);
  for (const f of files) {
    const fp = String(f).replace(/\\/g, "/");
    for (const r of regs) {
      if (r.test(fp)) return true;
    }
  }
  return false;
}

function anyExtensionMatches(exts, files) {
  if (!exts || exts.length === 0) return false;
  const norm = exts.map((e) => String(e).toLowerCase());
  for (const f of files) {
    const fp = String(f).toLowerCase();
    for (const e of norm) {
      if (fp.endsWith(e)) return true;
    }
  }
  return false;
}

function heuristicsMatch(heuristics, stats) {
  if (!heuristics || typeof heuristics !== "object") return false;
  if (!stats || typeof stats !== "object") return false;

  const filesAdded = Number(stats.files_added || 0);
  const locAdded = Number(stats.total_loc_added || 0);
  const newTopDirs = Number(stats.new_top_level_dirs || 0);

  if (
    heuristics.files_added_gte !== undefined &&
    filesAdded < Number(heuristics.files_added_gte)
  )
    return false;

  if (
    heuristics.total_loc_added_gte !== undefined &&
    locAdded < Number(heuristics.total_loc_added_gte)
  )
    return false;

  if (
    heuristics.new_top_level_dirs_gte !== undefined &&
    newTopDirs < Number(heuristics.new_top_level_dirs_gte)
  )
    return false;

  return Object.keys(heuristics).length > 0;
}

function authorityIndex(order, level) {
  const i = order.indexOf(level);
  return i === -1 ? -1 : i;
}

function maxAuthority(order, levels) {
  let best = order[0] || "low";
  let bestIdx = authorityIndex(order, best);
  for (const lvl of levels) {
    const idx = authorityIndex(order, lvl);
    if (idx > bestIdx) {
      best = lvl;
      bestIdx = idx;
    }
  }
  return best;
}

function stableDominant(matched, classToAuthority, order) {
  let dom = matched[0];
  let domAuth = classToAuthority[dom] || order[0] || "low";
  let domIdx = authorityIndex(order, domAuth);

  for (const c of matched) {
    const a = classToAuthority[c] || order[0] || "low";
    const idx = authorityIndex(order, a);

    if (idx > domIdx) {
      dom = c;
      domIdx = idx;
      domAuth = a;
    } else if (idx === domIdx) {
      if (String(c) < String(dom)) dom = c; // deterministic tie-break
    }
  }
  return dom;
}

function classifyBySurfaceRegistry(registry, ctx) {
  if (!registry) throw new Error("classifyBySurfaceRegistry: registry is required");

  const authority_order = Array.isArray(registry.authority_order)
    ? registry.authority_order
    : ["low", "medium", "high", "critical"];

  const action_classes = registry.action_classes || {};
  const files = (ctx?.files_changed || []).map((f) => String(f).replace(/\\/g, "/"));
  const stats = ctx?.stats || null;

  const matched = [];
  const classToAuthority = {};
  const signals = [];

  for (const [classId, def] of Object.entries(action_classes)) {
    const min_authority = def?.min_authority || authority_order[0] || "low";
    classToAuthority[classId] = min_authority;

    const match = def?.match || {};
    const pathHit = anyPathMatches(match.any_paths || [], files);
    const extHit = anyExtensionMatches(match.any_extensions || [], files);
    const heurHit = heuristicsMatch(match.heuristics || null, stats);

    if (pathHit || extHit || heurHit) {
      matched.push(classId);
      if (classId === "secret_material") signals.push("possible_secret_material");
    }
  }

  if (matched.length === 0) {
    return {
      matched_classes: [],
      dominant_action_class: "code_change",
      required_authority: "medium",
      signals: ["no_registry_match_defaulted"],
    };
  }

  const required_authority = maxAuthority(
    authority_order,
    matched.map((c) => classToAuthority[c] || authority_order[0] || "low")
  );

  const dominant_action_class = stableDominant(matched, classToAuthority, authority_order);

  return {
    matched_classes: matched.slice().sort(),
    dominant_action_class,
    required_authority,
    signals,
  };
}

module.exports = { classifyBySurfaceRegistry };
