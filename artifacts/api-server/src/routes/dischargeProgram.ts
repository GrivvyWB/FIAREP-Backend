// City Violation Discharge Program — the free four months every plan starts
// with. The owner sets each client's program start and changeover date in
// Platform Control → Pricing ladder; on the changeover date the client is on
// the maintenance tier for its band (worked out from its units). Nothing is
// switched off: only the tier and its price change. Stored on the
// organization's features, so there is no schema change.
import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, organizationProperties, organizations } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";

const router: IRouter = Router();
router.use("/v1/platform/discharge-program", requirePlatformOwner);

type Program = { start: string | null; changeover: string | null };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD, New York time

function programOf(features: unknown): Program {
  const f = (features && typeof features === "object" ? features : {}) as Record<string, unknown>;
  const p = (f["dischargeProgram"] && typeof f["dischargeProgram"] === "object" ? f["dischargeProgram"] : {}) as Record<string, unknown>;
  const start = typeof p["start"] === "string" && DATE.test(p["start"]) ? p["start"] : null;
  const changeover = typeof p["changeover"] === "string" && DATE.test(p["changeover"]) ? p["changeover"] : null;
  return { start, changeover };
}
/** The client's tier right now: maintenance from the changeover date on. */
export function dischargeTier(features: unknown, on: string = today()): "program" | "maintenance" | "none" {
  const p = programOf(features);
  if (!p.start && !p.changeover) return "none";
  return p.changeover && on >= p.changeover ? "maintenance" : "program";
}

router.get("/v1/platform/discharge-program", async (_req, res) => {
  const orgs = await db.select({ id: organizations.id, name: organizations.name, licensedUnits: organizations.licensedUnits, features: organizations.features }).from(organizations);
  const ids = orgs.map((o) => o.id);
  const props = ids.length ? await db.select({ org: organizationProperties.organizationId, units: organizationProperties.units, active: organizationProperties.active }).from(organizationProperties).where(inArray(organizationProperties.organizationId, ids)) : [];
  const now = today();
  res.json(orgs.map((o) => {
    const registered = props.filter((p) => p.org === o.id && p.active).reduce((n, p) => n + (p.units ?? 0), 0);
    // Units: what the client is licensed for; the registered buildings when no licensed number is set.
    const units = o.licensedUnits ?? (registered || null);
    return { id: o.id, name: o.name, units, unitsFrom: o.licensedUnits != null ? "licensed" : registered ? "buildings" : null, ...programOf(o.features), tier: dischargeTier(o.features, now), today: now };
  }));
});

router.put("/v1/platform/discharge-program/:id", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const id = String(req.params["id"]);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
  const next: Program = { start: clean(b["start"]), changeover: clean(b["changeover"]) };
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "No such client." }); return; }
  const before = programOf(org.features);
  const features = { ...((org.features && typeof org.features === "object") ? org.features : {}), dischargeProgram: next };
  await db.update(organizations).set({ features, updatedAt: new Date() }).where(eq(organizations.id, id));
  await platformAudit(owner.name, "discharge-program.updated", id, before, next);
  res.json({ id, ...next, tier: dischargeTier(features) });
});

export default router;
