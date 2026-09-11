import { randomInt, randomUUID } from "node:crypto";
import type { Actor } from "./auth";

export const STAFF_ROLES = new Set([
  "administrator",
  "management",
  "worker",
  "inspector",
  "procurement",
  "vendor",
  "resident",
]);

export const STAFF_POSITIONS = [
  "Borough Director",
  "Regional Director",
  "Property Manager",
  "Assistant Property Manager",
  "Superintendent",
  "Assistant Superintendent",
  "Housing Assistant",
  "Maintenance Worker",
  "Caretaker",
  "Groundskeeper",
  "Janitorial Staff",
  "CPM",
  "Inspector",
  "Elevator Service",
  "Plumber",
  "Electrician",
  "Carpenter",
  "Roofer",
  "General Construction",
  "CCTV Installation",
  "Heating Service",
  "Staff Worker",
  "Director",
  "Other",
] as const;

export const ENTITIES = new Set([
  "projects",
  "rooms",
  "checklists",
  "cost-estimates",
  "project-scopes",
  "intakes",
  "inspections",
  "elevators",
  "roofplans",
  "project-notes",
  "project-reviews",
  "resident-reports",
  "violations",
  "building-violations",
  "priority-violations",
  "route-assignments",
  "procurement",
  "procurement-bids",
  "vendor-contacts",
  "vendor-quotes",
  "change-orders",
  "elevator-jobs",
  "emergency-units",
  "emergency-jobs",
  "leave-requests",
]);

const PRICING_KEYS = new Set([
  "amount",
  "amountCharged",
  "cost",
  "costs",
  "deduction",
  "finalAmount",
  "grandTotal",
  "origPrice",
  "price",
  "priceBy",
  "rates",
  "total",
  "totals",
  "unitCost",
  "unitPrice",
]);

const HIGH_RISK_ENTITIES = new Set([
  "procurement",
  "procurement-bids",
  "vendor-quotes",
  "change-orders",
]);

const ELEVATED_POSITIONS = new Set([
  "Borough Director",
  "Regional Director",
  "Superintendent",
]);

export function isElevated(actor: Actor): boolean {
  return (
    actor.role === "administrator" ||
    (actor.role === "management" && ELEVATED_POSITIONS.has(actor.position))
  );
}

export function canReadEntity(actor: Actor, entity: string): boolean {
  if (HIGH_RISK_ENTITIES.has(entity) && actor.role === "management") {
    return isElevated(actor);
  }
  return true;
}

export function developmentAllowed(
  actor: Actor,
  development: string | null,
): boolean {
  return (
    actor.role === "administrator" ||
    actor.developments.length === 0 ||
    !development ||
    actor.developments.includes(development)
  );
}

export function entityDevelopmentAllowed(
  actor: Actor,
  entity: string,
  development: string | null,
): boolean {
  if (
    entity === "projects" &&
    !development &&
    actor.role !== "administrator" &&
    actor.developments.length > 0
  ) {
    return false;
  }
  return developmentAllowed(actor, development);
}

export function canCreateEntity(actor: Actor, entity: string): boolean {
  if (entity === "emergency-units" || entity === "emergency-jobs") {
    return (
      actor.role === "administrator" ||
      (actor.role === "management" &&
        ["Borough Director", "Regional Director"].includes(actor.position))
    );
  }
  if (entity === "procurement-bids" || entity === "vendor-quotes") return true;
  if (entity === "procurement") {
    return actor.role === "inspector" && actor.position === "CPM";
  }
  if (entity === "building-violations" || entity === "route-assignments") {
    return ["administrator", "management", "inspector"].includes(actor.role);
  }
  return !["resident", "vendor"].includes(actor.role);
}

export function canMutateEntity(actor: Actor, entity: string): boolean {
  if (entity === "procurement" || entity === "procurement-bids") {
    return actor.role === "procurement";
  }
  return canCreateEntity(actor, entity);
}

export function canDeleteEntity(
  actor: Actor,
  state: Record<string, unknown>,
): boolean {
  if (actor.role === "worker" || actor.role === "inspector") {
    return state["clearedByMgmt"] === true;
  }
  return actor.role === "administrator" || actor.role === "management";
}

export function stripPricing(
  actor: Actor,
  value: unknown,
): unknown {
  if (
    !(
      actor.role === "worker" ||
      actor.role === "inspector" ||
      actor.role === "vendor"
    )
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => stripPricing(actor, item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRICING_KEYS.has(key))
      .map(([key, item]) => [key, stripPricing(actor, item)]),
  );
}

export function generatedCode(entity: string): string | undefined {
  const five = () => randomInt(0, 100000).toString().padStart(5, "0");
  if (entity === "resident-reports") return `RC-${five()}`;
  if (entity === "procurement") return `sr-${five()}`;
  if (entity === "elevator-jobs") return `EL-${five()}`;
  if (entity === "emergency-jobs") return `EM-${five()}`;
  if (entity === "emergency-units") {
    return `TRK-${randomInt(0, 10000).toString().padStart(4, "0")}`;
  }
  return undefined;
}

export function recordId(input: unknown): string {
  return typeof input === "string" && input.trim() ? input : randomUUID();
}

export function staffCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(
    "",
  );
}