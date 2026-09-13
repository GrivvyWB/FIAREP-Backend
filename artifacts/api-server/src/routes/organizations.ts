import { Router, type IRouter } from "express";
import { randomUUID, randomInt } from "node:crypto";
import { and, count, eq, inArray, desc, isNull, sql } from "drizzle-orm";
import { db, entityRecords, organizationProperties, organizations, staffAccounts, refreshSessions, platformLicenseAudit } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { effectiveLicenseStatus, evaluateLicense } from "../lib/auth";
import { platformAudit } from "../lib/audit";
import {
  getTimeClockConfig,
  mergeTimeClockConfig,
  rejectUnimplementedExternalIntegration,
  type TimeClockConfig,
} from "../lib/timeClock";
import { allocateStaffCode } from "../lib/staffCodes";

const router: IRouter = Router();
router.use("/v1/platform/organizations", requirePlatformOwner);

export const ORGANIZATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ORGANIZATION_CODE_ATTEMPTS = 20;

export function generateOrganizationCode(nextIndex = () => randomInt(ORGANIZATION_CODE_ALPHABET.length)): string {
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix += ORGANIZATION_CODE_ALPHABET[nextIndex()];
  }
  return `ORG-${suffix}`;
}

/** Must be called inside the transaction that will create the organization. */
export async function allocateOrganizationCode(tx: any): Promise<string> {
  // Serialize allocation across all API workers while retaining the uniqueness check
  // and insert in the same transaction.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('organization-code-allocation'))`);
  for (let attempt = 0; attempt < ORGANIZATION_CODE_ATTEMPTS; attempt += 1) {
    const candidate = generateOrganizationCode();
    const [existing] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, candidate)).limit(1);
    if (!existing) return candidate;
  }
  throw Object.assign(new Error("Unable to allocate a unique organization code"), { status: 503 });
}

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
  return {
    ...org,
    status: effectiveLicenseStatus(org),
  };
}

router.get("/v1/platform/organizations", async (_req, res) => {
  await evaluateLicense("default");
  const rows = await db.select().from(organizations);
  const result = await Promise.all(rows.map(async (org) => {
    const [staffRows, propertyRows, recordRows] = await Promise.all([
      db.select({
        id: staffAccounts.id,
        developments: staffAccounts.developments,
        createdAt: staffAccounts.createdAt,
      }).from(staffAccounts).where(eq(staffAccounts.tenantId, org.id)),
      db.select({
        development: organizationProperties.development,
        active: organizationProperties.active,
        createdAt: organizationProperties.createdAt,
      }).from(organizationProperties).where(eq(organizationProperties.organizationId, org.id)),
      db.select({
        entity: entityRecords.entity,
        development: entityRecords.development,
        createdAt: entityRecords.createdAt,
      }).from(entityRecords).where(and(
        eq(entityRecords.tenantId, org.id),
        eq(entityRecords.deleted, false),
      )),
    ]);
    const names = [...new Set([
      ...staffRows.flatMap((row) => row.developments),
      ...propertyRows.map((row) => row.development),
      ...recordRows.map((row) => row.development),
    ].filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim()))].sort((a, b) => a.localeCompare(b));
    const developments = names.map((name) => {
      const properties = propertyRows.filter((row) => row.development?.trim() === name);
      const records = recordRows.filter((row) => row.development?.trim() === name);
      const assignedStaff = staffRows.filter((row) => row.developments.some((value) => value.trim() === name));
      const dates = [
        ...properties.map((row) => row.createdAt),
        ...records.map((row) => row.createdAt),
        ...assignedStaff.map((row) => row.createdAt),
      ];
      return {
        name,
        active: properties.length === 0 || properties.some((row) => row.active),
        staff: assignedStaff.length,
        projects: records.filter((row) => row.entity === "projects").length,
        records: records.length,
        connectedAt: new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString(),
      };
    });
    return {
      ...publicOrganization(org),
      usage: { staff: staffRows.length, developments: developments.length },
      developments,
    };
  }));
  res.json(result);
});

router.get("/v1/platform/organizations/:id/time-clock", async (req, res) => {
  const [organization] = await db.select({
    id: organizations.id,
    features: organizations.features,
  }).from(organizations).where(eq(organizations.id, req.params.id!)).limit(1);
  if (!organization) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.json({ organizationId: organization.id, ...getTimeClockConfig(organization.features) });
});

router.patch("/v1/platform/organizations/:id/time-clock", async (req, res) => {
  const id = req.params.id!;
  const body = req.body as Record<string, unknown>;
  const allowed = ["integrationEnabled", "mobileClockEnabled", "provider"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    res.status(400).json({ error: "Unknown time-clock configuration field" });
    return;
  }
  for (const key of ["integrationEnabled", "mobileClockEnabled"]) {
    if (key in body && typeof body[key] !== "boolean") {
      res.status(400).json({ error: `${key} must be a boolean` });
      return;
    }
  }
  const integrationError = rejectUnimplementedExternalIntegration({
    integrationEnabled: typeof body.integrationEnabled === "boolean" ? body.integrationEnabled : undefined,
    provider: "provider" in body ? body.provider as string | null : undefined,
  });
  if (integrationError) {
    res.status(400).json({ error: integrationError });
    return;
  }
  const patch: Partial<TimeClockConfig> = {};
  for (const key of allowed) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key];
  }
  const updatedResult = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(organizations).where(eq(organizations.id, id)).limit(1).for("update");
    if (!locked) return null;
    const features = mergeTimeClockConfig(locked.features, patch);
    const [updated] = await tx.update(organizations).set({
      features,
      updatedAt: new Date(),
    }).where(eq(organizations.id, id)).returning();
    return { before: locked, organization: updated };
  });
  if (!updatedResult) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const { before, organization } = updatedResult;
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "organization.time_clock_updated", id, before, organization);
  res.json({ organizationId: id, ...getTimeClockConfig(organization.features) });
});

router.get("/v1/platform/license-audit", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 25));
  res.json(await db.select().from(platformLicenseAudit).orderBy(desc(platformLicenseAudit.at)).limit(limit));
});

router.post("/v1/platform/organizations", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if ("id" in body) {
    res.status(400).json({ error: "Organization id is system-generated and cannot be supplied" });
    return;
  }
  if (!name) {
    res.status(400).json({ error: "Organization name is required" });
    return;
  }
  const status = body["status"] === "suspended" || body["status"] === "expired" || body["status"] === "active" ? body["status"] : "active";
  const directorName = typeof body["directorName"] === "string" ? body["directorName"].trim() : "";
  if ("directorCode" in body) {
    res.status(400).json({ error: "Director codes are generated automatically" });
    return;
  }
  if (!directorName) {
    res.status(400).json({ error: "Director name is required" });
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
  if (staffLimit !== null && (staffLimit as number) < 1) {
    res.status(400).json({ error: "Staff limit must allow the initial administrator" });
    return;
  }
   const requestedFeatures = typeof body["features"] === "object" && body["features"] !== null && !Array.isArray(body["features"]) ? body["features"] as Record<string, unknown> : {};
   const features = mergeTimeClockConfig(requestedFeatures, { integrationEnabled: false, provider: null });
  const unrestricted = body["unrestricted"] === true;
  try {
    const result = await db.transaction(async (tx) => {
      const id = await allocateOrganizationCode(tx);
      const [created] = await tx.insert(organizations).values({ id, name, status, startsAt, endsAt, staffLimit: staffLimit as number | null, propertyLimit: propertyLimit as number | null, features, unrestricted }).returning();
      const generatedDirectorCode = await allocateStaffCode(tx, id, directorName);
      const [director] = await tx.insert(staffAccounts).values({
        id: randomUUID(), tenantId: id, name: directorName, code: generatedDirectorCode,
        role: "administrator", position: "Borough Director", status: "approved", developments: [], issuerName: "Platform owner",
      }).returning();
      return { organization: created, director, generatedDirectorCode };
    });
    const owner = res.locals["platformOwner"] as { name: string };
    await platformAudit(owner.name, "organization.created_with_director", result.organization.id, null, result.organization);
    res.status(201).json({
      organization: result.organization,
      director: {
        id: result.director.id,
        name: result.director.name,
        tenantId: result.director.tenantId,
        code: result.generatedDirectorCode,
      },
    });
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/v1/platform/organizations/:id/director-code", async (req, res) => {
  const organizationId = req.params.id!;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Administrator name is required" });
    return;
  }
  const owner = res.locals["platformOwner"] as { name: string };
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-limit:${organizationId}`}))`);
      const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (!organization) throw Object.assign(new Error("Organization not found"), { status: 404 });
      const directors = await tx.select().from(staffAccounts).where(and(
        eq(staffAccounts.tenantId, organizationId),
        eq(staffAccounts.role, "administrator"),
        eq(staffAccounts.position, "Borough Director"),
      )).limit(2);
      if (directors.length > 1) {
        throw Object.assign(new Error("Multiple Borough Director accounts require staff-account repair"), { status: 409 });
      }
      const existingDirector = directors[0];
      if (existingDirector && existingDirector.name.trim().toLowerCase() !== name.toLowerCase()) {
        throw Object.assign(new Error("Use the existing Borough Director name to reset this code"), { status: 409 });
      }
      const code = await allocateStaffCode(tx, organizationId, name);
      if (existingDirector) {
        const [updated] = await tx.update(staffAccounts).set({
          code,
          status: "approved",
          sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
          updatedAt: new Date(),
        }).where(eq(staffAccounts.id, existingDirector.id)).returning();
        return { account: updated, code, created: false };
      }
      const sameNameAccounts = await tx.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
        eq(staffAccounts.tenantId, organizationId),
        sql`lower(${staffAccounts.name}) = lower(${name})`,
      )).limit(1);
      if (sameNameAccounts.length > 0) {
        throw Object.assign(new Error("That name belongs to a non-director staff account"), { status: 409 });
      }
      if (organization.staffLimit !== null) {
        const [{ value }] = await tx.select({ value: count() }).from(staffAccounts).where(eq(staffAccounts.tenantId, organizationId));
        if (Number(value) >= organization.staffLimit) {
          throw Object.assign(new Error("Organization staff license limit reached"), { status: 403 });
        }
      }
      const [account] = await tx.insert(staffAccounts).values({
        id: randomUUID(),
        tenantId: organizationId,
        name,
        code,
        role: "administrator",
        position: "Borough Director",
        status: "approved",
        developments: [],
        issuerName: owner.name,
      }).returning();
      return { account, code, created: true };
    });
    await platformAudit(
      owner.name,
      result.created ? "organization.director_created" : "organization.director_code_reset",
      organizationId,
      null,
      result.account,
    );
    res.status(result.created ? 201 : 200).json({
      id: result.account.id,
      name: result.account.name,
      tenantId: result.account.tenantId,
      code: result.code,
    });
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
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
  if ("features" in body) {
    if (!body["features"] || typeof body["features"] !== "object" || Array.isArray(body["features"])) {
      res.status(400).json({ error: "Invalid features" });
      return;
    }
    updates.features = mergeTimeClockConfig(body["features"], { integrationEnabled: false, provider: null });
  }
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

router.delete("/v1/platform/organizations/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (id === "default") {
    res.status(400).json({ error: "Default organization cannot be deleted" });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`organization-delete:${id}`}))`);
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!organization) return null;

    const [{ value: staffCount }] = await tx.select({ value: count() }).from(staffAccounts).where(eq(staffAccounts.tenantId, id));
    const [{ value: propertyCount }] = await tx.select({ value: count() }).from(organizationProperties).where(eq(organizationProperties.organizationId, id));
    if (Number(staffCount) > 0 || Number(propertyCount) > 0) {
      throw Object.assign(new Error("Remove all staff and registered properties before deleting this organization"), { status: 409 });
    }

    await tx.delete(organizations).where(eq(organizations.id, id));
    return organization;
  }).catch((error: any) => {
    if (error?.status === 409) return error;
    throw error;
  });

  if (!deleted) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  if (deleted instanceof Error) {
    res.status(409).json({ error: deleted.message });
    return;
  }

  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "organization.deleted", id, deleted, null);
  res.status(204).send();
});

export default router;