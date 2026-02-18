const core = require("@actions/core");
const { runGate } = require("./gate-run2");

async function main() {
  try {
    const intentPath = core.getInput("intent_path") || "INTENT.json";
    const registryPath = core.getInput("registry_path") || ".prism/surface_registry.yaml";
    const bootstrapLockPath = core.getInput("bootstrap_lock_path") || ".prism/bootstrap.lock";
    const meaningOutPath = core.getInput("meaning_out_path") || "meaning.json";

    const result = runGate({ intentPath, registryPath, bootstrapLockPath, meaningOutPath });

    // Emit summary
    core.notice(`Run 2 decision: ${result.decision}`);
    core.notice(`Dominant action class: ${result.dominant_action_class || "n/a"}`);
    core.notice(`Authority: required=${result.required_authority || "n/a"} declared=${result.declared_authority || "n/a"}`);

    if (result.decision !== "pass") {
      core.setFailed(`Gate failed: ${result.reasons.join("; ")}`);
    }
  } catch (err) {
    core.setFailed(err?.message || String(err));
  }
}

main();
