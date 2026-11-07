// Full control from Platform Control: when a button is switched on for a person (on their own,
// or for everyone on their home screen), the records that button works with open for that person
// whatever their title. The record still belongs to their own company.
import { eq } from "drizzle-orm";
import { db, organizations } from "@workspace/db";
import type { Actor } from "./auth";

const EMERGENCY = ["emergency-jobs", "emergency-units"];
const VIOLATIONS = ["violations", "building-violations", "priority-violations"];
/** Button (its switch name) → the records its page reads and works on. */
const BUTTON_ENTITIES: Record<string, string[]> = {
  "manage-all-requests": ["resident-reports", "change-orders"],
  "resident-reports": ["resident-reports"],
  "review-reports": ["resident-reports"],
  "priority-queue": ["resident-reports"],
  "in-house-assignments": ["resident-reports"],
  "assign-a-job": ["resident-reports"],
  "staff-member-jobs": ["resident-reports"],
  "add-job-for-mgmt": ["resident-reports", "projects"],
  "change-orders": ["change-orders"],
  "change-work-order": ["change-orders"],
  "send-violation": VIOLATIONS,
  "log-violations": VIOLATIONS,
  "inspection-approvals": ["inspections", ...VIOLATIONS],
  "my-inspections": ["inspections", ...VIOLATIONS],
  "hud-inspections": ["hud-inspections"],
  "submit-scope": ["procurement", ...VIOLATIONS],
  "cpm-supervisor-scope-review": ["procurement", ...VIOLATIONS],
  "leave-calendar": ["leave-requests"],
  "assign-route": ["route-assignments"],
  "my-routes": ["route-assignments"],
  "emergency-activity": EMERGENCY,
  "emergency-units": EMERGENCY,
  "assign-emergency-unit": EMERGENCY,
  "manage-trucks": EMERGENCY,
  "truck-scores": EMERGENCY,
  "elevator-dashboard": ["elevators", "elevator-jobs"],
  "elevator-jobs": ["elevators", "elevator-jobs"],
};

const cache = new Map<string, { at: number; modules: Record<string, unknown> }>();
async function modulesOf(tenantId: string): Promise<Record<string, unknown>> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 20_000) return hit.modules;
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = (((org?.features ?? {}) as Record<string, unknown>)["modules"] ?? {}) as Record<string, unknown>;
  cache.set(tenantId, { at: Date.now(), modules });
  return modules;
}

/** The buttons switched on for this person: their own switches win over everyone's. */
export async function switchedOnButtons(actor: Pick<Actor, "id" | "tenantId">): Promise<Set<string>> {
  const modules = await modulesOf(actor.tenantId);
  const on = new Set<string>(); const own = new Map<string, boolean>();
  for (const [k, v] of Object.entries(modules)) {
    if (typeof v !== "boolean") continue;
    const p = k.match(/^p\.([^.]+)\.apptab\.[a-z]+\.(.+)$/);
    if (p) { if (p[1] === actor.id) own.set(p[2]!, own.get(p[2]!) === true || v); continue; }
    const c = k.match(/^apptab\.[a-z]+\.(.+)$/);
    if (c && v) on.add(c[1]!);
  }
  for (const [slug, v] of own) { if (v) on.add(slug); else on.delete(slug); }
  return on;
}

/** Does a switched-on button open this kind of record for the person? */
export async function switchGrants(actor: Actor, entity: string): Promise<boolean> {
  if (!actor?.id || actor.role === "administrator") return false;
  const on = await switchedOnButtons(actor);
  for (const slug of on) if (BUTTON_ENTITIES[slug]?.includes(entity)) return true;
  return false;
}
