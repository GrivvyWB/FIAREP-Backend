import type { Staff } from "@workspace/api-client-react";

const OPERATIONAL_ROLES = new Set(["management", "worker", "inspector", "emergency"]);
const FIELD_ROLES = new Set(["worker", "inspector", "emergency"]);

export const TRADE_CREW_SECTIONS = [
  { label: "Plumber Supervisor & Crew", supervisor: "Plumber Supervisor", crew: "Plumber" },
  { label: "Electric Supervisor & Crew", supervisor: "Electric Supervisor", crew: "Electrician" },
  { label: "Elevator Supervisor & Crew", supervisor: "Elevator Supervisor", crew: "Elevator Service" },
  { label: "Painter Supervisor & Crew", supervisor: "Painter Supervisor", crew: "Painter" },
  { label: "Carpenter Supervisor & Crew", supervisor: "Carpenter Supervisor", crew: "Carpenter" },
] as const;

const TRADE_POSITIONS = new Set(
  TRADE_CREW_SECTIONS.flatMap((section) => [section.supervisor, section.crew]),
);
const TRADE_SUPERVISOR_POSITIONS = new Set(
  TRADE_CREW_SECTIONS.map((section) => section.supervisor),
);

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
    if (candidate.role === "management") {
      return isRegionalDirector || TRADE_SUPERVISOR_POSITIONS.has(candidate.position as never);
    }
    return FIELD_ROLES.has(candidate.role);
  });
}

export function groupStaffByTradeSections(
  staff: Staff[],
  otherLabel = "Other Operational Staff",
) {
  const byName = (a: Staff, b: Staff) => a.name.localeCompare(b.name);
  const tradeGroups = TRADE_CREW_SECTIONS.flatMap((section) => {
    const people = staff
      .filter((member) => member.position === section.supervisor || member.position === section.crew)
      .sort((a, b) => {
        const aSupervisor = a.position === section.supervisor ? 0 : 1;
        const bSupervisor = b.position === section.supervisor ? 0 : 1;
        return aSupervisor - bSupervisor || byName(a, b);
      });
    return people.length ? [{ label: section.label, people }] : [];
  });
  const other = staff.filter((member) => !TRADE_POSITIONS.has(member.position as never)).sort(byName);
  return other.length ? [...tradeGroups, { label: otherLabel, people: other }] : tradeGroups;
}

export function groupTeamDirectoryStaff(staff: Staff[]) {
  const procurement = staff.filter((member) => member.role === "procurement");
  const nonProcurement = staff.filter((member) => member.role !== "procurement");
  const groups = groupStaffByTradeSections(nonProcurement, "Management & Other Staff");
  return procurement.length
    ? [...groups, { label: "Procurement", people: procurement.sort((a, b) => a.name.localeCompare(b.name)) }]
    : groups;
}