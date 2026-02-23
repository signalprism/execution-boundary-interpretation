function normalizeEvent({ surface, payload }) {
  if (!surface) throw new Error("normalizeEvent requires surface");
  if (!payload || typeof payload !== "object") {
    throw new Error("normalizeEvent requires payload object");
  }

  let eventClass = "unknown";
  if (surface === "github.pull_request") eventClass = "code_change";
  if (surface === "agent.tool_call") eventClass = "tool_call";

  return {
    class: eventClass,
    surface,
    payload,
  };
}

module.exports = { normalizeEvent };
