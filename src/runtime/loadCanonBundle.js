const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

function readYaml(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  return yaml.load(raw);
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function mustExist(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`Missing required file: ${absPath}`);
  }
}

function resolveRef(baseDir, refPath) {
  return path.resolve(baseDir, refPath);
}

function loadCanonBundle(bundleRoot) {
  const root = path.resolve(bundleRoot);

  mustExist(root);
  mustExist(path.join(root, "canon.yaml"));
  mustExist(path.join(root, "promotion.yaml"));

  const canon = readYaml(path.join(root, "canon.yaml"));
  const promotion = readYaml(path.join(root, "promotion.yaml"));

  const layerDirs = (canon?.composition?.layer_order || []).map((p) =>
    path.join(root, p)
  );
  if (layerDirs.length === 0) {
    throw new Error(`canon.yaml has no composition.layer_order`);
  }

  const packs = [];
  for (const layerDir of layerDirs) {
    const packPath = path.join(layerDir, "pack.yaml");
    if (!fs.existsSync(packPath)) continue;
    packs.push({ layerDir, pack: readYaml(packPath) });
  }
  if (packs.length === 0) throw new Error(`No pack.yaml found in layer_order`);

  const foundation = packs[0];
  const foundationDir = foundation.layerDir;
  const foundationPack = foundation.pack;

  const domainRefs = foundationPack?.domain?.refs;
  if (!domainRefs?.domain_pack) {
    throw new Error(`Foundation pack missing domain.refs.domain_pack`);
  }

  const domain = {
    domain_pack: readYaml(resolveRef(foundationDir, domainRefs.domain_pack)),
    entities: domainRefs.entities
      ? readYaml(resolveRef(foundationDir, domainRefs.entities))
      : null,
    relationships: domainRefs.relationships
      ? readYaml(resolveRef(foundationDir, domainRefs.relationships))
      : null,
    expectations: domainRefs.expectations
      ? readYaml(resolveRef(foundationDir, domainRefs.expectations))
      : null,
    interpretive_rules: domainRefs.interpretive_rules
      ? readYaml(resolveRef(foundationDir, domainRefs.interpretive_rules))
      : null,
    narrative_fragments: domainRefs.narrative_fragments
      ? readYaml(resolveRef(foundationDir, domainRefs.narrative_fragments))
      : null,
  };

  const prismEntry = (foundationPack?.prisms || [])[0];
  if (!prismEntry?.ref) {
    throw new Error(`Foundation pack missing prisms[0].ref`);
  }
  const prism = readYaml(resolveRef(foundationDir, prismEntry.ref));

  const schemaRel =
    canon?.schemas?.interpretation_artifact ||
    (foundationPack?.schemas || [])[0];
  if (!schemaRel) throw new Error(`No interpretation artifact schema path set`);
  const schemaPath = path.join(root, schemaRel);

  const indexPath = path.join(root, "artifacts", "bundle.index.json");
  const bundleIndex = fs.existsSync(indexPath) ? readJson(indexPath) : null;

  return {
    root,
    canon,
    promotion,
    packs,
    foundation: { dir: foundationDir, pack: foundationPack },
    domain,
    prism,
    schemaPath,
    bundleIndex,
    indexPath,
  };
}

module.exports = { loadCanonBundle };
