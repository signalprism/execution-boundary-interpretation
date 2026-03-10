const { runActionBoundary } = require("./runActionBoundary");
const core = require("@actions/core");
const { interpretBoundary } = require("./runtime/interpretBoundary");

async function main() {
  try {
    const intentPath =
      process.env.INTENT_PATH ||
      core.getInput("intent_path") ||
      "INTENT.json";

    const authorityContractPath =
      process.env.AUTHORITY_CONTRACT_PATH ||
      core.getInput("authority_contract_path") ||
      "";

    const registryPath =
      process.env.REGISTRY_PATH ||
      core.getInput("registry_path") ||
      ".prism/surface_registry.yaml";

    const bootstrapLockPath =
      process.env.BOOTSTRAP_LOCK_PATH ||
      core.getInput("bootstrap_lock_path") ||
      ".prism/bootstrap.lock";

    const meaningOutPath =
      process.env.MEANING_OUT_PATH ||
      core.getInput("meaning_out_path") ||
      "out/meaning.json";

    const mutationReportOutPath =
      process.env.MUTATION_REPORT_OUT_PATH ||
      core.getInput("mutation_report_out_path") ||
      "out/mutation_report.json";

    if (authorityContractPath) {
      process.env.AUTHORITY_CONTRACT_PATH = authorityContractPath;
    }

    const actionBoundaryResult = runActionBoundary();

    core.notice(`Action boundary decision: ${actionBoundaryResult.decision.result}`);
    core.notice(`Action boundary artifact: ${actionBoundaryResult.artifactPath}`);
    core.notice(`Action type: ${actionBoundaryResult.classified.actionType}`);
    core.notice(`Signal surface: ${actionBoundaryResult.request.source_signal.surface}`);

    if (
      actionBoundaryResult.decision.result === "deny" ||
      actionBoundaryResult.decision.result === "escalate"
    ) {
      core.setFailed(
        `Action boundary blocked execution: ${actionBoundaryResult.decision.reasonCodes.join("; ")}`
      );
      return;
    }

    if (process.env.ACTION_BOUNDARY_ONLY === "1") {
      core.notice("Action-boundary-only mode enabled; skipping legacy boundary runtime.");
      return;
    }

    const result = interpretBoundary({
      intentPath,
      registryPath,
      bootstrapLockPath,
      meaningOutPath,
      mutationReportOutPath,
    });

    core.notice(`Boundary decision: ${result.decision}`);
    core.notice(`Dominant action class: ${result.dominant_action_class || "n/a"}`);
    core.notice(
      `Authority: required=${result.required_authority || "n/a"} declared=${result.declared_authority || "n/a"}`
    );

    if (result.decision !== "pass") {
      core.setFailed(`Gate failed: ${result.reasons.join("; ")}`);
    }
  } catch (err) {
    core.setFailed(err?.message || String(err));
  }
}

main();
