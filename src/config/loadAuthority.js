// src/config/loadAuthority.js
const fs = require("fs");
const path = require("path");

function readJsonOrThrow(p) {
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${p}: ${e.message}`);
  }
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function mapMutationClassToTier(mc) {
  const m = String(mc || "").toLowerCase();
  const map = { patch: "medium", minor: "high", major: "critical" };
  return map[m] || "medium";
}

/**
 * Canonical Authority Contract object returned by this loader.
 */
function normalizeAuthorityContract(raw, sourcePath) {
  if (raw?.schema === "sp.authority_contract.v1") {
    return {
      schema: raw.schema,
      source_path: sourcePath,

      contract_id: raw.contract_id || "ac.unknown",
      contract_version: raw.contract_version || "1.0.0",

      purpose: raw.purpose || { statement: "", bind_to_change: false },

      surface_scope: raw.surface_scope || { include: ["**/*"], exclude: [] },

      allowed_mutation_classes: Array.isArray(raw.allowed_mutation_classes)
        ? raw.allowed_mutation_classes
        : [],

      escalation: raw.escalation || { tier: "low", allow_escalation: false },

      domain_context: raw.domain_context || null,

      constraints: raw.constraints || {
        max_files: null,
        allow_deletions: false,
        allow_renames: false,
        allow_moves: false,
      },

      declared_by: raw.declared_by || null,

      raw,
    };
  }

  // Legacy INTENT.json support (Run-2 style) :contentReference[oaicite:0]{index=0}
  if (raw && typeof raw === "object" && raw.declared_authority) {
    return {
      schema: "sp.authority_contract.v1",
      source_path: sourcePath,

      contract_id: "ac.legacy.intent",
      contract_version: "1.0.0",

      purpose: { statement: raw.intent || "", bind_to_change: true },

      // Legacy intent had no explicit scope; default to allow all
      surface_scope: { include: ["**/*"], exclude: [] },

      // Legacy intent had no mutation classes; empty means "don’t enforce list"
      allowed_mutation_classes: [],

      escalation: { tier: String(raw.declared_authority), allow_escalation: false },

      domain_context: null,

      constraints: raw.constraints || {
        max_files: null,
        allow_deletions: false,
        allow_renames: false,
        allow_moves: false,
      },

      declared_by: null,

      raw,
    };
  }

  // Legacy agent-style INTENT.json :contentReference[oaicite:1]{index=1}
  if (raw && typeof raw === "object" && raw.mutation_class) {
    return {
      schema: "sp.authority_contract.v1",
      source_path: sourcePath,

      contract_id: "ac.legacy.agent_intent",
      contract_version: "1.0.0",

      purpose: {
        statement: `agent=${raw.agent || "unknown"} mutation_class=${raw.mutation_class}`,
        bind_to_change: true,
      },

      surface_scope: {
        include: Array.isArray(raw.scope) && raw.scope.length ? raw.scope : ["**/*"],
        exclude: [],
      },

      allowed_mutation_classes: [],

      escalation: { tier: mapMutationClassToTier(raw.mutation_class), allow_escalation: false },

      domain_context: null,

      constraints: {
        max_files: typeof raw.max_files === "number" ? raw.max_files : null,
        allow_deletions: !!raw.allow_deletions,
        allow_renames: !!raw.allow_renames,
        allow_moves: !!raw.allow_moves,
      },

      declared_by: { actor: "agent", agent: raw.agent || "unknown" },

      raw,
    };
  }

  // Fallback (deterministic)
  return {
    schema: "sp.authority_contract.v1",
    source_path: sourcePath,
    contract_id: "ac.unknown",
    contract_version: "1.0.0",
    purpose: { statement: "", bind_to_change: false },
    surface_scope: { include: ["**/*"], exclude: [] },
    allowed_mutation_classes: [],
    escalation: { tier: "low", allow_escalation: false },
    domain_context: null,
    constraints: {
      max_files: null,
      allow_deletions: false,
      allow_renames: false,
      allow_moves: false,
    },
    declared_by: null,
    raw,
  };
}

/**
 * Prefer AUTHORITY_CONTRACT.json if present, else use INTENT.json.
 */
function loadAuthority({ authorityPath, intentPath }) {
  const defaultAuthority = authorityPath || process.env.AUTHORITY_CONTRACT_PATH || "AUTHORITY_CONTRACT.json";
  const legacyIntent = intentPath || process.env.INTENT_PATH || "INTENT.json";

  const pick =
    exists(defaultAuthority) ? defaultAuthority :
    exists(legacyIntent) ? legacyIntent :
    null;

  if (!pick) {
    throw new Error(`No authority file found. Expected ${defaultAuthority} or ${legacyIntent}`);
  }

  const raw = readJsonOrThrow(pick);
  return normalizeAuthorityContract(raw, pick);
}

module.exports = { loadAuthority };
