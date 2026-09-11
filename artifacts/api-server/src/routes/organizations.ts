import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { db, entityRecords, organizations, staffAccounts } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { evaluateLicense } from "../lib/auth";

const router: IRouter = Router();
router.use("/v1/platform/organizations", requirePlatformOwner);

function publicOrganization(org: typeof organizations.$inferSelect) {
  return org;
}

router.get("/v1/platform/organizations", async (_req, res) => {
  await evaluateLicense("default");
  const rows = await db.select().from(organizations);
  const result = await Promise.all(rows.map(async (org) => {
    const [{ value: staffCount }] = await db.select({ value: count() }).from(staffAccounts).where(eq(staffAccounts.tenantId, org.id));
    const [{ value: propertyCount }] = await db.select({ value: count() }).from(entityRecords).where(and(eq(entityRecords.tenantId, org.id), eq(entityRecords.entity, "properties"), eq(entityRecords.deleted, false)));
    return { ...publicOrganization(org), usage: { staff: Number(staffCount), properties: Number(propertyCount) } };
  }));
  res.json(result);
});

router.post("/v1/platform/organizations", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const id = typeof body["id"] === "string" ? body["id"].trim() : "";
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if (!id || !name || id === "default") {
    res.status(400).json({ error: "A non-default id and name are required" });
    return;
  }
  const status = body["status"] === "suspended" || body["status"] === "expired" ? body["status"] : "active";
  const directorCode = typeof body["directorCode"] === "string" ? body["directorCode"].trim().toUpperCase() : "";
  const directorName = typeof body["directorName"] === "string" ? body["directorName"].trim() : "";
  if (directorCode && (!/^[A-HJ-NP-Z2-9]{4}$/.test(directorCode) || !directorName)) {
    res.status(400).json({ error: "directorName and a valid 4-character directorCode are required" });
    return;
  }
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (existing) { res.status(409).json({ error: "Organization already exists" }); return; }
  const [org] = await db.insert(organizations).values({
    id, name, status,
    startsAt: typeof body["startsAt"] === "string" ? new Date(body["startsAt"]) : null,
    endsAt: typeof body["endsAt"] === "string" ? new Date(body["endsAt"]) : null,
    staffLimit: typeof body["staffLimit"] === "number" ? body["staffLimit"] : null,
    propertyLimit: typeof body["propertyLimit"] === "number" ? body["propertyLimit"] : null,
    features: typeof body["features"] === "object" && body["features"] !== null ? body["features"] as Record<string, unknown> : {},
    unrestricted: body["unrestricted"] === true,
  }).returning();
  let director;
  if (directorCode) {
    [director] = await db.insert(staffAccounts).values({
      id: randomUUID(), tenantId: id, name: directorName, code: directorCode,
      role: "administrator", position: "Borough Director", status: "approved", developments: [], issuerName: "Platform owner",
    }).returning();
  }
  res.status(201).json({ organization: org, ...(director ? { director: { id: director.id, name: director.name, tenantId: director.tenantId } } : {}) });
});

router.patch("/v1/platform/organizations/:id", async (req, res) => {
  const id = req.params.id;
  if (id === "default") { res.status(400).json({ error: "Default organization cannot be modified" }); return; }
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["name", "status", "startsAt", "endsAt", "staffLimit", "propertyLimit", "features", "unrestricted"]) {
    if (key in body) updates[key] = body[key];
  }
  if (typeof updates["status"] === "string" && !["active", "suspended", "expired"].includes(updates["status"] as string)) {
    res.status(400).json({ error: "Invalid organization status" }); return;
  }
  if ("startsAt" in updates) updates["startsAt"] = updates["startsAt"] ? new Date(String(updates["startsAt"])) : null;
  if ("endsAt" in updates) updates["endsAt"] = updates["endsAt"] ? new Date(String(updates["endsAt"])) : null;
  const [org] = await db.update(organizations).set({ ...updates, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
  res.json(org);
});

export default router;