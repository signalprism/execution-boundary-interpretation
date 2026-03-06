const fs = require("fs");
const path = require("path");
const minimatch = require("minimatch");

const DEFAULT_CATALOG_PATH = path.join(
  process.cwd(),
  "domain-pack",
  "sp.domain.devops.github_pr",
  "1.0.0",
  "mutation-classes.default.v1.json"
);

function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function matchPathGlob(filePath, include = [], exclude = []) {
  const included = include.some((g) => minimatch(filePath, g, { dot: true }));
  const excluded = exclude.some((g) => minimatch(filePath, g, { dot: true }));
  return included && !excluded;
}

function matchContentRegex(diffText, pattern) {
  const regex = new RegExp(pattern);
  return regex.test(diffText);
}

function evaluateMutations(changedFiles, options = {}) {
  const catalog = loadCatalog(options.catalogPath);
  const findings = [];

  for (const file of changedFiles) {
    for (const cls of catalog.classes) {
      let matched = false;

      for (const matcher of cls.matchers) {
        if (matcher.type === "path_glob") {
          if (matchPathGlob(file.filePath, matcher.include || [], matcher.exclude || [])) {
            matched = true;
          }
        }

        if (matcher.type === "content_regex") {
          if (matchContentRegex(file.diffText, matcher.pattern)) {
            matched = true;
          }
        }
      }

      if (!matched) continue;

      findings.push({
        mutation_class_id: cls.mutation_class_id,
        class_version: cls.class_version,
        severity: cls.severity_default,
        implied_authority: cls.implied_authority_default,
        confidence: 1.0,
        evidence: [
          {
            evidence_type: "file_path",
            path: file.filePath,
            signals: { matched_class: cls.mutation_class_id }
          }
        ]
      });
    }
  }

  return findings;
}

module.exports = { evaluateMutations, loadCatalog };
