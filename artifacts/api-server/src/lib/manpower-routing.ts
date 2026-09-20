export function supervisorTargetForReleasedWork(state: Record<string, unknown>) {
  const dispatchingSupervisorId = typeof state["dispatchingSupervisorId"] === "string"
    ? state["dispatchingSupervisorId"].trim()
    : "";
  if (dispatchingSupervisorId) return dispatchingSupervisorId;

  return typeof state["receiverSupervisorId"] === "string"
    ? state["receiverSupervisorId"].trim()
    : "";
}