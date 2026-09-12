import type { Staff } from "@workspace/api-client-react";

const OPERATIONAL_ROLES = new Set(["management", "worker", "inspector", "emergency"]);
const FIELD_ROLES = new Set(["worker", "inspector", "emergency"]);

function withinDevelopments(candidate: Staff, developments: string[]) {
  return candidate.developments.length > 0 &&
    candidate.developments.every((development) => developments.includes(development));
}

export function assignableOperationalStaff(
  actor: Staff | null,
  candidates: Staff[],
  development?: string | null,
) {
  if (!actor) return [];
  const isBoroughDirector = actor.position === "Borough Director";
  const isRegionalDirector = actor.position === "Regional Director";

  return candidates.filter((candidate) => {
    if (candidate.id === actor.id || candidate.position === "Borough Director") return false;
    if (!OPERATIONAL_ROLES.has(candidate.role)) return false;
    if (development && !candidate.developments.includes(development)) return false;
    if (isBoroughDirector) return true;
    if (!withinDevelopments(candidate, actor.developments)) return false;
    if (candidate.role === "management") return isRegionalDirector;
    return FIELD_ROLES.has(candidate.role);
  });
}