// Turning a client's violation alerts on or off from FIAREP's Command Center (Face ID),
// the same switches as Platform Control → Modules: "Violation Alerts (menu page)" and
// "Violation Alerts — Upper Management Complaint Command". Clients never switch these.
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { platformAudit } from "../audit";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function findClient(ref: string) {
  const r = ref.trim().toLowerCase();
  const orgs = (await db.select().from(organizations)).filter((o) => o.id !== "default");
  const exact = orgs.filter((o) => o.id.toLowerCase() === r || o.name.toLowerCase() === r);
  const hits = exact.length ? exact : orgs.filter((o) => o.name.toLowerCase().includes(r));
  if (hits.length === 1) return { org: hits[0]! };
  if (!hits.length) return { error: `No client called "${ref}".` };
  return { error: `"${ref}" matches more than one client: ${hits.slice(0, 6).map((o) => o.name).join(", ")}. Say which.` };
}

export async function clientAlertsStatus(ref: string) {
  const f = await findClient(ref); if ("error" in f) return f;
  const m = obj(obj(f.org.features)["modules"]);
  const [w] = await db.select({ n: sql<number>`count(*)::int` }).from(entityRecords).where(and(eq(entityRecords.entity, "watch-buildings"), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'organizationId' = ${f.org.id}`));
  return { client: f.org.name, alertsPage: m["violation-alerts"] === true, complaintCommandStrip: m["violation-alerts-command"] === true, watchedBuildings: w?.n ?? 0 };
}

export async function setClientAlerts(ref: string, change: { page?: boolean; command?: boolean }, by: string) {
  if (typeof change.page !== "boolean" && typeof change.command !== "boolean") return { error: "Say whether to turn the Alerts page and/or the Complaint Command strip on or off." };
  const f = await findClient(ref); if ("error" in f) return f;
  const features = obj(f.org.features);
  const modules = { ...obj(features["modules"]) };
  if (typeof change.page === "boolean") modules["violation-alerts"] = change.page;
  if (typeof change.command === "boolean") modules["violation-alerts-command"] = change.command;
  const [after] = await db.update(organizations).set({ features: { ...features, modules }, updatedAt: new Date() }).where(eq(organizations.id, f.org.id)).returning();
  await platformAudit(`${by} (Command Center)`, "organization.modules_changed", f.org.id, f.org, after);
  return clientAlertsStatus(f.org.id);
}
