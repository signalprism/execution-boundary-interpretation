function emitMeaningArtifact({
  canon,
  canonHash,
  domainPack,
  prism,
  event,
  declared,
  domainOutput,
  prismOutput,
  understanding,
  gateResult,
}) {
  return {
    schema: "sp.interpretation_artifact.v2",
    canon: {
      canon_id: canon.canon_id,
      canon_version: canon.canon_version,
      canon_hash: canonHash,
    },
    domain_pack: {
      domain_pack_id: domainPack.domain_pack_id,
      domain_pack_version: domainPack.domain_pack_version,
    },
    prism: {
      prism_id: prism.prism_id,
      prism_version: prism.prism_version,
    },
    event,
    declared,
    domain: domainOutput,
    prism_output: prismOutput,
    understanding,
    posture: {
      worldview_posture: "advisory",
      gate_result: gateResult,
      notes: "Dev wedge: worldview is advisory-only; gate_result reflects tooling enforcement.",
    },
  };
}

module.exports = { emitMeaningArtifact };
