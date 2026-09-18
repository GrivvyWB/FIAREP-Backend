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

const TITLE_FAMILIES = [
  {
    label: "Plumber",
    positions: ["Plumber Supervisor", "Supervisor Plumber", "Plumber"],
  },
  {
    label: "Electrician",
    positions: ["Electric Supervisor", "Electrician Supervisor", "Supervisor Electrician", "Electrician"],
  },
  {
    label: "Elevator Service",
    positions: ["Elevator Supervisor", "Elevator Service Supervisor", "Supervisor Elevator", "Elevator Service"],
  },
  {
    label: "Painter",
    positions: ["Painter Supervisor", "Supervisor Painter", "Painter"],
  },
  {
    label: "Carpenter",
    positions: ["Carpenter Supervisor", "Supervisor Carpenter", "Carpenter"],
  },
  {
    label: "Inspector",
    positions: ["Inspector Supervisor", "Inspection Supervisor", "Supervisor Inspector", "Inspector"],
  },
  {
    label: "CPM",
    positions: ["CPM Supervisor", "Supervisor CPM", "CPM"],
  },
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

type DirectoryLocation = {
  label: string;
  people: Staff[];
};

export type TeamDirectoryGroup = {
  label: string;
  subtitle: string;
  locations: DirectoryLocation[];
};

function titleFamily(position: string) {
  return TITLE_FAMILIES.find((family) =>
    family.positions.some((candidate) => candidate.toLowerCase() === position.toLowerCase())
  )?.label || position;
}

function stationaryLocation(member: Staff) {
  if (member.developments.length === 1) return member.developments[0]!;
  if (member.developments.length > 1) return `${member.developments.length} assigned developments`;
  return "All assigned developments";
}

function groupedLocations(people: Staff[]): DirectoryLocation[] {
  const locations = new Map<string, Staff[]>();
  for (const member of people) {
    const location = stationaryLocation(member);
    locations.set(location, [...(locations.get(location) || []), member]);
  }
  return [...locations.entries()]
    .map(([label, members]) => ({
      label,
      people: members.sort((a, b) => {
        const aSupervisor =
          a.position === "Borough Director" ||
          a.role === "human_resources" ||
          a.role === "management" ||
          a.position.toLowerCase().includes("supervisor") ? 0 : 1;
        const bSupervisor =
          b.position === "Borough Director" ||
          b.role === "human_resources" ||
          b.role === "management" ||
          b.position.toLowerCase().includes("supervisor") ? 0 : 1;
        return aSupervisor - bSupervisor || a.name.localeCompare(b.name);
      }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function groupTeamDirectoryByTitleAndLocation(
  staff: Staff[],
  hrDisplayMemberIds: ReadonlySet<string>,
): TeamDirectoryGroup[] {
  const hrPeople = staff.filter((member) => hrDisplayMemberIds.has(member.id));
  const emergencyMaintenance = staff
    .filter((member) =>
      member.position === "Superintendent Ⓔ" ||
      (member.role === "emergency" && member.position === "Maintenance Worker")
    )
    .sort((a, b) => {
      if (a.position === "Superintendent Ⓔ") return -1;
      if (b.position === "Superintendent Ⓔ") return 1;
      const aTruck = /^TRK-(\d+)/i.exec(a.name)?.[1];
      const bTruck = /^TRK-(\d+)/i.exec(b.name)?.[1];
      if (aTruck && bTruck) return Number(aTruck) - Number(bTruck);
      if (aTruck) return -1;
      if (bTruck) return 1;
      return a.name.localeCompare(b.name);
    });
  const emergencyMaintenanceIds = new Set(emergencyMaintenance.map((member) => member.id));
  const regularPeople = staff.filter((member) =>
    !hrDisplayMemberIds.has(member.id) &&
    !emergencyMaintenanceIds.has(member.id)
  );
  const titles = new Map<string, Staff[]>();
  for (const member of regularPeople) {
    const title = member.role === "procurement" ? "Procurement" : titleFamily(member.position);
    titles.set(title, [...(titles.get(title) || []), member]);
  }
  const groups = [...titles.entries()]
    .map(([label, people]) => ({
      label,
      subtitle: [...new Set(people.map((member) => member.position))]
        .sort((a, b) => {
          const aSupervisor = a.toLowerCase().includes("supervisor") ? 0 : 1;
          const bSupervisor = b.toLowerCase().includes("supervisor") ? 0 : 1;
          return aSupervisor - bSupervisor || a.localeCompare(b);
        })
        .join(" · "),
      locations: groupedLocations(people),
    }))
    .sort((a, b) => {
      const leadership = (group: TeamDirectoryGroup) =>
        group.locations.some((location) => location.people.some((member) =>
          member.position === "Borough Director" ||
          member.role === "management" ||
          member.position.toLowerCase().includes("supervisor"),
        )) ? 0 : 1;
      return leadership(a) - leadership(b) || a.label.localeCompare(b.label);
    });
  const emergencyGroup = emergencyMaintenance.length
    ? [{
        label: "Emergency Maintenance",
        subtitle: "Managed by Superintendent Ⓔ",
        locations: [{ label: "All assigned developments", people: emergencyMaintenance }],
      }]
    : [];
  return hrPeople.length
    ? [{
        label: "HR",
        subtitle: "Human Resources staff list",
        locations: groupedLocations(hrPeople),
      }, ...emergencyGroup, ...groups]
    : [...emergencyGroup, ...groups];
}