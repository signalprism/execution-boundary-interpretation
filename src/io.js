const fs = require("fs");
const yaml = require("js-yaml");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readYaml(p) {
  return yaml.load(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function normalizeSlashes(p) {
  return String(p || "").replace(/\\/g, "/");
}

module.exports = { readJson, readYaml, writeJson, fileExists, normalizeSlashes };
