import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, desc, isNull, sql } from "drizzle-orm";
import { db, organizationProperties, organizations, staffAccounts, refreshSessions, platformLicenseAudit } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { evaluateLicense } from "../lib/auth";
import { platformAudit } from "../lib/audit";

const router: IRouter = Router();
router.use("/v1/platform/organizations", requirePlatformOwner);

function propertyInput(body: Record<string, unknown>) {
  const displayAddress = typeof body.displayAddress === "string" ? body.displayAddress.trim() : "";
  const normalizedAddress = displayAddress.toLowerCase().replace(/\s+/g, " ");
  if (!displayAddress || normalizedAddress.length < 3) throw Object.assign(new Error("A valid displayAddress is required"), { status: 400 });
  return {
    displayAddress,
    normalizedAddress,
    development: typeof body.development === "string" ? body.development.trim() || null : null,
    active: body.active !== false,
  };
}

router.get("/v1/platform/organizations/:organizationId/properties", async (req, res) => {
  res.json(await db.select().from(organizationProperties).where(eq(organizationProperties.organizationId, req.params.organizationId!)));
});

router.post("/v1/platform/organizations/:organizationId/properties", async (req, res) => {
  const organizationId = req.params.organizationId!;
  try {
    const input = propertyInput(req.body as Record<string, unknown>);
    const property = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`property-limit:${organizationId}`}))`);
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
      const [{ value }] = await tx.select({ value: count() }).from(organizationProperties).where(eq(organizationProperties.organizationId, organizationId));
      if (org.propertyLimit !== null && Number(value) >= org.propertyLimit) throw Object.assign(new Error("Organization property license limit reached"), { status: 403 });
      const [created] = await tx.insert(organizationProperties).values({ id: randomUUID(), organizationId, ...input }).returning();
      return created;
    });
    const owner = res.locals["platformOwner"] as { name: string };
    await platformAudit(owner.name, "property.created", organizationId, null, property);
    res.status(201).json(property);
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return; }
    if (error?.code === "23505") { res.status(409).json({ error: "That address is already registered" }); return; }
    throw error;
  }
});

router.patch("/v1/platform/organizations/:organizationId/properties/:propertyId", async (req, res) => {
  const organizationId = req.params.organizationId!;
  const [before] = await db.select().from(organizationProperties).where(and(eq(organizationProperties.id, req.params.propertyId!), eq(organizationProperties.organizationId, organizationId))).limit(1);
  if (!before) { res.status(404).json({ error: "Property not found" }); return; }
  try {
    const body = req.body as Record<string, unknown>;
    const input = "displayAddress" in body || "development" in body || "active" in body ? propertyInput({ ...before, ...body }) : {};
    const [updated] = await db.update(organizationProperties).set({ ...input, updatedAt: new Date() }).where(and(eq(organizationProperties.id, before.id), eq(organizationProperties.organizationId, organizationId))).returning();
    const owner = res.locals["platformOwner"] as { name: string };
    await platformAudit(owner.name, "property.updated", organizationId, before, updated);
    res.json(updated);
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return; }
    if (error?.code === "23505") { res.status(409).json({ error: "That address is already registered" }); return; }
    throw error;
  }
});

router.delete("/v1/platform/organizations/:organizationId/properties/:propertyId", async (req, res) => {
  const organizationId = req.params.organizationId!;
  const [before] = await db.select().from(organizationProperties).where(and(eq(organizationProperties.id, req.params.propertyId!), eq(organizationProperties.organizationId, organizationId))).limit(1);
  if (!before) { res.status(404).json({ error: "Property not found" }); return; }
  await db.delete(organizationProperties).where(and(eq(organizationProperties.id, before.id), eq(organizationProperties.organizationId, organizationId)));
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "property.deleted", organizationId, before, null);
  res.status(204).send();
});

function publicOrganization(org: typeof organizations.$inferSelect) {
  return org;
}

router.get("/v1/platform/organizations", async (_req, res) => {
  await evaluateLicense("default");
  const rows = await db.select().from(organizations);
  const result = await Promise.all(rows.map(async (org) => {
    const [{ value: staffCount }] = await db.select({ value: count() }).from(staffAccounts).where(eq(staffAccounts.tenantId, org.id));
     const [{ value: propertyCount }] = await db.select({ value: count() }).from(organizationProperties).where(eq(organizationProperties.organizationId, org.id));
    return { ...publicOrganization(org), usage: { staff: Number(staffCount), properties: Number(propertyCount) } };
  }));
  res.json(result);
});

router.get("/v1/platform/license-audit", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 25));
  res.json(await db.select().from(platformLicenseAudit).orderBy(desc(platformLicenseAudit.at)).limit(limit));
});

router.post("/v1/platform/organizations", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const id = typeof body["id"] === "string" ? body["id"].trim() : "";
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if (!id || !name || id === "default") {
    res.status(400).json({ error: "A non-default id and name are required" });
    return;
  }
  const status = body["status"] === "suspended" || body["status"] === "expired" || body["status"] === "active" ? body["status"] : "active";
  const directorCode = typeof body["directorCode"] === "string" ? body["directorCode"].trim().toUpperCase() : "";
  const directorName = typeof body["directorName"] === "string" ? body["directorName"].trim() : "";
  if (directorCode && (!/^[A-HJ-NP-Z2-9]{4}$/.test(directorCode) || !directorName)) {
    res.status(400).json({ error: "directorName and a valid 4-character directorCode are required" });
    return;
  }
  const startsAt = body["startsAt"] == null ? null : new Date(String(body["startsAt"]));
  const endsAt = body["endsAt"] == null ? null : new Date(String(body["endsAt"]));
  const staffLimit = body["staffLimit"] == null ? null : body["staffLimit"];
  const propertyLimit = body["propertyLimit"] == null ? null : body["propertyLimit"];
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime())) || (startsAt && endsAt && startsAt >= endsAt) ||
      (staffLimit !== null && (!Number.isInteger(staffLimit) || (staffLimit as number) < 0)) ||
      (propertyLimit !== null && (!Number.isInteger(propertyLimit) || (propertyLimit as number) < 0))) {
    res.status(400).json({ error: "Invalid license dates or limits" }); return;
  }
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (existing) { res.status(409).json({ error: "Organization already exists" }); return; }
  const features = typeof body["features"] === "object" && body["features"] !== null && !Array.isArray(body["features"]) ? body["features"] as Record<string, unknown> : {};
  const unrestricted = body["unrestricted"] === true;
  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(organizations).values({ id, name, status, startsAt, endsAt, staffLimit: staffLimit as number | null, propertyLimit: propertyLimit as number | null, features, unrestricted }).returning();
    let director;
    if (directorCode) {
      [director] = await tx.insert(staffAccounts).values({
      id: randomUUID(), tenantId: id, name: directorName, code: directorCode,
      role: "administrator", position: "Borough Director", status: "approved", developments: [], issuerName: "Platform owner",
      }).returning();
    }
    return { organization: created, director };
  });
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, directorCode ? "organization.created_with_director" : "organization.created", id, null, result.organization);
  res.status(201).json({ organization: result.organization, ...(result.director ? { director: { id: result.director.id, name: result.director.name, tenantId: result.director.tenantId } } : {}) });
});

router.patch("/v1/platform/organizations/:id", async (req, res) => {
  const id = req.params.id;
  if (id === "default") { res.status(400).json({ error: "Default organization cannot be modified" }); return; }
  const body = req.body as Record<string, unknown>;
  const [before] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!before) { res.status(404).json({ error: "Organization not found" }); return; }
  const allowed = ["name", "status", "startsAt", "endsAt", "staffLimit", "propertyLimit", "features", "unrestricted"] as const;
  if (Object.keys(body).some((key) => !allowed.includes(key as typeof allowed[number]))) { res.status(400).json({ error: "Unknown organization field" }); return; }
  const updates: Partial<typeof organizations.$inferInsert> = {};
  if ("name" in body) { if (typeof body["name"] !== "string" || !body["name"].trim()) { res.status(400).json({ error: "Organization name is required" }); return; } updates.name = body["name"].trim(); }
  if ("status" in body) updates.status = body["status"] as string;
  if (updates.status && !["active", "suspended", "expired"].includes(updates.status)) {
    res.status(400).json({ error: "Invalid organization status" }); return;
  }
  for (const key of ["startsAt", "endsAt"] as const) if (key in body) { const value = body[key] == null ? null : new Date(String(body[key])); if (value && Number.isNaN(value.getTime())) { res.status(400).json({ error: "Invalid date" }); return; } updates[key] = value; }
  for (const key of ["staffLimit", "propertyLimit"] as const) if (key in body) { const value = body[key]; if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) { res.status(400).json({ error: "Invalid limit" }); return; } updates[key] = value as number | null; }
  if ("features" in body) { if (!body["features"] || typeof body["features"] !== "object" || Array.isArray(body["features"])) { res.status(400).json({ error: "Invalid features" }); return; } updates.features = body["features"] as Record<string, unknown>; }
  if ("unrestricted" in body) { if (typeof body["unrestricted"] !== "boolean") { res.status(400).json({ error: "Invalid unrestricted flag" }); return; } updates.unrestricted = body["unrestricted"]; }
  const effectiveStartsAt = "startsAt" in updates ? updates.startsAt : before.startsAt;
  const effectiveEndsAt = "endsAt" in updates ? updates.endsAt : before.endsAt;
  if (effectiveStartsAt && effectiveEndsAt && effectiveStartsAt >= effectiveEndsAt) { res.status(400).json({ error: "Start date must precede end date" }); return; }
  const [org] = await db.update(organizations).set({ ...updates, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
  if ((org.status === "suspended" || org.status === "expired") && before.status !== org.status) {
    const staff = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(eq(staffAccounts.tenantId, id));
    if (staff.length) await db.update(refreshSessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(inArray(refreshSessions.staffId, staff.map((s) => s.id)), isNull(refreshSessions.revokedAt)));
  }
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "organization.updated", id, before, org);
  res.json(org);
});

export default router;