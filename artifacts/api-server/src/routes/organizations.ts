import { Router, type IRouter } from "express";
import { randomUUID, randomInt } from "node:crypto";
import { and, asc, count, eq, inArray, desc, isNull, sql } from "drizzle-orm";
import { db, entityRecords, organizationProperties, organizations, staffAccounts, refreshSessions, platformLicenseAudit } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { effectiveLicenseStatus, evaluateLicense } from "../lib/auth";
import { platformAudit } from "../lib/audit";
import { endPilot, expirePilots, getPilotPrices, markPilotRefunded, purchasePilot, savePilotPrices, setPilotPaid, startPilot } from "../lib/pilot";
import { loadHrPositions, saveHrPositions } from "../lib/hrPositions";
import { applySetupTemplate, getSetupTemplate, saveSetupTemplate } from "../lib/setupTemplate";
import { ensureResidentCode, newResidentCode, withResidentCode } from "../lib/residentRouting";
import {
  getTimeClockConfig,
  mergeTimeClockConfig,
  rejectUnimplementedExternalIntegration,
  type TimeClockConfig,
} from "../lib/timeClock";
import { allocateStaffCode } from "../lib/staffCodes";
import {
  addConfiguredDevelopmentName,
  addOrganizationNameForDevelopmentType,
  getConfiguredDevelopmentNames,
} from "../lib/organizationDevelopments";
import { researchOrganization } from "../lib/organizationResearch";
import { dofBuildingsByOwner, lookupBuildingUnits } from "../lib/dofCharges";
import { hasCityData, isUsCountry, normalizeAddress, regionValue } from "../lib/jurisdiction";
import { COUNTRIES } from "../lib/countries";
import { countryCode, countryOn } from "../lib/countrySwitches";

const router: IRouter = Router();
router.use("/v1/platform/organizations", requirePlatformOwner);

router.post("/v1/platform/organizations/research", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (name.length < 2 || name.length > 160) {
    res.status(400).json({ error: "Organization name is required" });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Organization research is unavailable" });
    return;
  }
  try {
    res.json(await researchOrganization(name, apiKey));
  } catch (error) {
    req.log.warn({ err: error, organizationName: name }, "Organization research failed");
    res.status(503).json({ error: "Organization research is temporarily unavailable" });
  }
});

export const ORGANIZATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ORGANIZATION_CODE_ATTEMPTS = 20;
const DEFAULT_HR_EMAIL = "fiarep@outlook.com";

function normalizeHrEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : null;
}

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
  if (!displayAddress || displayAddress.trim().length < 3) throw Object.assign(new Error("A valid displayAddress is required"), { status: 400 });
  // Where the building is. Nothing said means New York City, which is where
  // every building registered before the platform went multi-state is.
  const city = typeof body.city === "string" ? body.city.trim() || null : null;
  // Any country. Nothing said means the United States.
  const rawCountry = typeof body.country === "string" ? body.country.trim().slice(0, 80) : "";
  const country = isUsCountry(rawCountry) ? null : rawCountry;
  const state = regionValue(body.state, country) || null;
  const postalCode = typeof body.postalCode === "string" ? body.postalCode.trim() || null : null;
  const normalizedAddress = normalizeAddress(displayAddress, city, state, country);
  if (normalizedAddress.length < 3) throw Object.assign(new Error("A valid displayAddress is required"), { status: 400 });
  return {
    displayAddress,
    normalizedAddress,
    city,
    state,
    postalCode,
    country,
    development: typeof body.development === "string" ? body.development.trim() || null : null,
    active: body.active !== false,
  };
}

router.get("/v1/platform/organizations/:organizationId/properties", async (req, res) => {
  res.json(await db.select().from(organizationProperties).where(eq(organizationProperties.organizationId, req.params.organizationId!)));
});

// Platform owner: list a client's staff (minimal fields) so the control panel can
// assign per-user access (e.g. project tools) to named workers.
router.get("/v1/platform/organizations/:organizationId/staff", async (req, res) => {
  const rows = await db
    .select({
      id: staffAccounts.id,
      name: staffAccounts.name,
      role: staffAccounts.role,
      position: staffAccounts.position,
      status: staffAccounts.status,
    })
    .from(staffAccounts)
    .where(eq(staffAccounts.tenantId, req.params.organizationId!))
    .orderBy(asc(staffAccounts.name));
  res.json(rows);
});

router.post("/v1/platform/organizations/:organizationId/properties", async (req, res) => {
  const organizationId = req.params.organizationId!;
  try {
    const body = req.body as Record<string, unknown>;
    const input = propertyInput(body);
    // Platform Control → Countries: a building only in a country FIAREP is switched on in.
    const cc = countryCode(input.country);
    if (!cc) { res.status(400).json({ error: `"${input.country}" isn't a country FIAREP knows. Type the country's name, e.g. Canada.` }); return; }
    if (!(await countryOn(cc))) { res.status(403).json({ error: `${COUNTRIES[cc] || input.country} is off. Switch it on in Platform Control → Countries first.` }); return; }
    // The building's unit count comes from the City's record for the address
    // (DOF roll, else PLUTO). A typed "units" is accepted only when the City has
    // no figure, so a client cannot register a 166-unit building as 20 units.
    let cityUnits = 0; let bbl: string | null = null; let unitsSource: string | null = null;
    // Only New York City has a tax roll we can read. Everywhere else the unit
    // count is typed in, which the needsUnits answer below asks for.
    if (hasCityData(input.city, input.state, input.country)) {
      try { const found = await lookupBuildingUnits(input.displayAddress); if (found) { cityUnits = found.units; bbl = found.bbl; unitsSource = found.source; if (found.displayAddress && !input.displayAddress.includes(",")) { input.displayAddress = found.displayAddress; input.normalizedAddress = normalizeAddress(found.displayAddress, input.city, input.state); } } } catch { /* City lookup unavailable: fall back to a typed figure */ }
    }
    const typedUnits = Number.isInteger(body["units"]) && (body["units"] as number) > 0 ? (body["units"] as number) : 0;
    let units = cityUnits > 0 ? cityUnits : typedUnits;
    // Several entrances on one tax lot (1351 / 1352 / 1353 Main St on one BBL): the City
    // counts the lot once, so a second address on a BBL already registered goes in at 0.
    const sameLot = bbl ? await db.select({ id: organizationProperties.id }).from(organizationProperties).where(and(eq(organizationProperties.organizationId, organizationId), eq(organizationProperties.bbl, bbl))).limit(1) : [];
    if (sameLot.length > 0) units = 0;
    else if (units <= 0) {
      const outside = !hasCityData(input.city, input.state, input.country);
      res.status(400).json({
        error: outside
          ? "Type the number of dwelling units to register this building — only New York City publishes a unit count we can read."
          : "The City has no unit count for this address. Type the number of dwelling units to register it.",
        needsUnits: true,
      });
      return;
    }
    const property = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`property-limit:${organizationId}`}))`);
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
      const [{ value }] = await tx.select({ value: count() }).from(organizationProperties).where(eq(organizationProperties.organizationId, organizationId));
      if (org.propertyLimit !== null && Number(value) >= org.propertyLimit) throw Object.assign(new Error("Organization property license limit reached"), { status: 403 });
      // Licensed units: every active building's City unit count, plus this one, must fit what the client pays for.
      if (org.licensedUnits !== null && !org.unrestricted) {
        const [{ registered }] = await tx.select({ registered: sql<number>`coalesce(sum(${organizationProperties.units}), 0)` }).from(organizationProperties).where(and(eq(organizationProperties.organizationId, organizationId), eq(organizationProperties.active, true)));
        const have = Number(registered) || 0;
        if (units > 0 && have + units > org.licensedUnits) throw Object.assign(new Error(`${org.licensedUnits.toLocaleString("en-US")} units licensed, ${have.toLocaleString("en-US")} registered — this building adds ${units.toLocaleString("en-US")} (${unitsSource || "typed"}). Raise the licensed units on the company to ${(have + units).toLocaleString("en-US")} to add it.`), { status: 403, licensedUnits: org.licensedUnits, registeredUnits: have, buildingUnits: units });
      }
      const [created] = await tx.insert(organizationProperties).values({ id: randomUUID(), organizationId, ...input, units, bbl }).returning();
      if (input.development) {
        await tx.update(organizations).set({
          features: addConfiguredDevelopmentName(org.features, input.development),
          updatedAt: new Date(),
        }).where(eq(organizations.id, organizationId));
      }
      return created;
    });
    const owner = res.locals["platformOwner"] as { name: string };
    await platformAudit(owner.name, "property.created", organizationId, null, property);
    res.status(201).json(property);
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message, licensedUnits: error.licensedUnits, registeredUnits: error.registeredUnits, buildingUnits: error.buildingUnits }); return; }
    if (error?.code === "23505") { res.status(409).json({ error: "That address is already registered" }); return; }
    throw error;
  }
});

// Every building on the DOF roll under an owner name, so a client's whole
// portfolio can be added at once. Marks the ones this client already has and
// the ones registered to another client.
router.get("/v1/platform/organizations/:organizationId/dof-owner", async (req, res) => {
  const organizationId = req.params.organizationId!;
  const owner = typeof req.query["owner"] === "string" ? req.query["owner"].trim() : "";
  if (owner.length < 3) { res.status(400).json({ error: "Type at least 3 letters of the owner name as it is on the DOF roll." }); return; }
  try {
    const { year, buildings } = await dofBuildingsByOwner(owner);
    const existing = buildings.length ? await db.select({ organizationId: organizationProperties.organizationId, normalizedAddress: organizationProperties.normalizedAddress, bbl: organizationProperties.bbl }).from(organizationProperties) : [];
    const mine = new Set(existing.filter((e) => e.organizationId === organizationId).flatMap((e) => [e.normalizedAddress, e.bbl || ""]));
    const others = new Set(existing.filter((e) => e.organizationId !== organizationId).flatMap((e) => [e.normalizedAddress, e.bbl || ""]));
    res.json({
      year,
      buildings: buildings.map((b) => {
        const key = normalizeAddress(b.displayAddress, null, null);
        return { ...b, added: mine.has(key) || mine.has(b.bbl), otherClient: !mine.has(key) && !mine.has(b.bbl) && (others.has(key) || others.has(b.bbl)) };
      }),
    });
  } catch (error: any) {
    res.status(502).json({ error: `DOF roll unavailable: ${error?.message || "try again"}` });
  }
});

// Add many buildings in one go (from the DOF roll). Each goes in ON the plan
// while it fits the licensed units; any that would go past them go in OFF,
// so every building is still there to switch on once the units are raised.
router.post("/v1/platform/organizations/:organizationId/properties/bulk", async (req, res) => {
  const organizationId = req.params.organizationId!;
  const list = Array.isArray(req.body?.buildings) ? (req.body.buildings as Record<string, unknown>[]) : [];
  const wanted = list.slice(0, 20000).map((b) => ({
    displayAddress: typeof b["displayAddress"] === "string" ? b["displayAddress"].trim() : "",
    bbl: typeof b["bbl"] === "string" ? b["bbl"].replace(/\D/g, "") || null : null,
    units: Number.isInteger(b["units"]) && (b["units"] as number) > 0 ? (b["units"] as number) : 0,
  })).filter((b) => b.displayAddress.length >= 3);
  if (wanted.length === 0) { res.status(400).json({ error: "No buildings to add." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`property-limit:${organizationId}`}))`);
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
      const existing = await tx.select({ organizationId: organizationProperties.organizationId, normalizedAddress: organizationProperties.normalizedAddress, bbl: organizationProperties.bbl, units: organizationProperties.units, active: organizationProperties.active }).from(organizationProperties);
      const taken = new Set(existing.map((e) => e.normalizedAddress));
      const lotsHere = new Set(existing.filter((e) => e.organizationId === organizationId && e.bbl).map((e) => e.bbl!));
      let count = existing.filter((e) => e.organizationId === organizationId).length;
      let onPlan = existing.filter((e) => e.organizationId === organizationId && e.active).reduce((n, e) => n + (e.units || 0), 0);
      const limited = org.licensedUnits !== null && !org.unrestricted;
      const rows: (typeof organizationProperties.$inferInsert)[] = [];
      let skipped = 0; let off = 0; let stopped = false;
      for (const b of wanted) {
        const normalizedAddress = normalizeAddress(b.displayAddress, null, null);
        if (taken.has(normalizedAddress) || (b.bbl && lotsHere.has(b.bbl))) { skipped += 1; continue; }
        if (org.propertyLimit !== null && count >= org.propertyLimit) { stopped = true; break; }
        const active = !limited || b.units === 0 || onPlan + b.units <= (org.licensedUnits as number);
        if (active) onPlan += b.units; else off += 1;
        rows.push({ id: randomUUID(), organizationId, displayAddress: b.displayAddress, normalizedAddress, city: null, state: null, postalCode: null, country: null, development: null, units: b.units, bbl: b.bbl, active });
        taken.add(normalizedAddress); if (b.bbl) lotsHere.add(b.bbl); count += 1;
      }
      for (let i = 0; i < rows.length; i += 500) await tx.insert(organizationProperties).values(rows.slice(i, i + 500)).onConflictDoNothing();
      return { added: rows.length, on: rows.length - off, off, skipped, stoppedAtPropertyLimit: stopped, propertyLimit: org.propertyLimit, licensedUnits: org.licensedUnits };
    });
    const owner = res.locals["platformOwner"] as { name: string };
    await platformAudit(owner.name, "property.bulk_created", organizationId, null, result);
    res.status(201).json(result);
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return; }
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
    // Switching a building ON the plan is held to the licensed units, the same
    // way adding one is. Without this a building could be registered off the
    // plan and then switched on past what the client pays for.
    if (body["active"] === true && !before.active && (before.units || 0) > 0) {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (org?.licensedUnits !== null && org?.licensedUnits !== undefined && !org.unrestricted) {
        const [{ registered }] = await db.select({ registered: sql<number>`coalesce(sum(${organizationProperties.units}), 0)` })
          .from(organizationProperties)
          .where(and(eq(organizationProperties.organizationId, organizationId), eq(organizationProperties.active, true)));
        const have = Number(registered) || 0;
        const adds = before.units || 0;
        if (have + adds > org.licensedUnits) {
          res.status(403).json({
            error: `${org.licensedUnits.toLocaleString("en-US")} units licensed, ${have.toLocaleString("en-US")} on the plan — this building adds ${adds.toLocaleString("en-US")}. Raise the licensed units on the company to ${(have + adds).toLocaleString("en-US")} to switch it on.`,
            licensedUnits: org.licensedUnits, registeredUnits: have, buildingUnits: adds,
          });
          return;
        }
      }
    }
    const [updated] = await db.update(organizationProperties).set({ ...input, updatedAt: new Date() }).where(and(eq(organizationProperties.id, before.id), eq(organizationProperties.organizationId, organizationId))).returning();
    if (updated?.development) {
      const [organization] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (organization) {
        await db.update(organizations).set({
          features: addConfiguredDevelopmentName(organization.features, updated.development),
          updatedAt: new Date(),
        }).where(eq(organizations.id, organizationId));
      }
    }
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
  await expirePilots().catch(() => 0);
  const rows = await db.select().from(organizations);
  for (const org of rows) {
    if (org.id === "default") continue;
    const code = await ensureResidentCode(org);
    org.features = withResidentCode(org.features, code);
  }
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
    const configuredNames = getConfiguredDevelopmentNames(org.features);
    const names = [...new Set([
      ...(configuredNames ?? []),
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
        active: configuredNames !== null
          ? configuredNames.includes(name)
          : properties.length === 0 || properties.some((row) => row.active),
        staff: assignedStaff.length,
        projects: records.filter((row) => row.entity === "projects").length,
        records: records.length,
        connectedAt: dates.length > 0
          ? new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString()
          : org.updatedAt.toISOString(),
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
  const externalIntegrationPatch: {
    integrationEnabled?: boolean;
    provider?: string | null;
  } = {};
  if (typeof body.integrationEnabled === "boolean") {
    externalIntegrationPatch.integrationEnabled = body.integrationEnabled;
  }
  if ("provider" in body) {
    externalIntegrationPatch.provider = body.provider as string | null;
  }
  const integrationError = rejectUnimplementedExternalIntegration(externalIntegrationPatch);
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

// Platform owner: issue a new login code for an organization's Administrator
// or Borough Director (nobody inside the organization can reset those). The
// old code stops working and every open session for that person is signed out.
router.post("/v1/platform/organizations/:organizationId/staff/:staffId/reset-code", async (req, res) => {
  const tenantId = req.params.organizationId!;
  const [target] = await db.select().from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, tenantId),
    eq(staffAccounts.id, req.params.staffId!),
  )).limit(1);
  if (!target) { res.status(404).json({ error: "Staff account not found" }); return; }
  if (target.role !== "administrator" && target.position !== "Borough Director") {
    res.status(400).json({ error: "Only Administrator and Borough Director codes are reset here; HR resets everyone else" });
    return;
  }
  const code = await db.transaction(async (tx) => {
    const next = await allocateStaffCode(tx, tenantId, target.name);
    await tx.update(staffAccounts)
      .set({ code: next, sessionVersion: sql`${staffAccounts.sessionVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(staffAccounts.tenantId, tenantId), eq(staffAccounts.id, target.id)));
    return next;
  });
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "staff.code_reset_by_platform_owner", tenantId, null, { staffId: target.id, name: target.name, position: target.position });
  res.json({ id: target.id, name: target.name, position: target.position, code });
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
  const hrEmail = body["hrEmail"] === undefined
    ? DEFAULT_HR_EMAIL
    : normalizeHrEmail(body["hrEmail"]);
  if (!hrEmail) {
    res.status(400).json({ error: "A valid HR email is required" });
    return;
  }
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
  const licensedUnits = body["licensedUnits"] == null ? null : body["licensedUnits"];
  if (licensedUnits !== null && (!Number.isInteger(licensedUnits) || (licensedUnits as number) < 0)) { res.status(400).json({ error: "Invalid licensed units" }); return; }
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
   const features = withResidentCode(addOrganizationNameForDevelopmentType(
     mergeTimeClockConfig(requestedFeatures, { integrationEnabled: false, provider: null }),
     name,
   ), await newResidentCode());
  const unrestricted = body["unrestricted"] === true;
  try {
    const result = await db.transaction(async (tx) => {
      const id = await allocateOrganizationCode(tx);
      const [created] = await tx.insert(organizations).values({ id, name, status, startsAt, endsAt, staffLimit: staffLimit as number | null, propertyLimit: propertyLimit as number | null, licensedUnits: licensedUnits as number | null, hrEmail, features, unrestricted }).returning();
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

// The 6-digit code residents type so their complaint lands with this
// company when the address alone can't tell companies apart.
router.post("/v1/platform/organizations/:id/resident-code", async (req, res) => {
  const id = String(req.params.id || "");
  const [before] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!before) { res.status(404).json({ error: "Organization not found" }); return; }
  const regenerate = !!(req.body && typeof req.body === "object" && (req.body as { regenerate?: unknown }).regenerate === true);
  if (!regenerate) { res.json({ code: await ensureResidentCode(before), created: false }); return; }
  const code = await newResidentCode();
  const [org] = await db.update(organizations)
    .set({ features: withResidentCode(before.features, code), updatedAt: new Date() })
    .where(eq(organizations.id, id)).returning();
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "organization.resident-code", id, before, org);
  res.json({ code, created: true });
});

// Platform Control → HR: job titles added for every company's HR form.
router.get("/v1/platform/hr-positions", requirePlatformOwner, async (_req, res) => { res.json(await loadHrPositions()); });
router.put("/v1/platform/hr-positions", requirePlatformOwner, async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const out = await saveHrPositions((req.body as { list?: unknown } | undefined)?.list);
  if ("error" in out) { res.status(400).json(out); return; }
  await platformAudit(owner.name, "hr_positions.saved", "default", null, { count: out.length });
  res.json(out);
});

// Small-client setup: save one client's Platform Control switches, apply them to a new client in one press.
router.get("/v1/platform/setup-template", requirePlatformOwner, async (_req, res) => {
  const t = await getSetupTemplate();
  res.json(t ? { fromId: t.fromId, fromName: t.fromName, savedAt: t.savedAt, savedBy: t.savedBy, switches: Object.keys(t.modules).length } : null);
});
router.post("/v1/platform/organizations/:id/save-as-setup", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const out = await saveSetupTemplate(String(req.params.id), owner.name);
  if ("error" in out) { res.status(out.status).json({ error: out.error }); return; }
  await platformAudit(owner.name, "setup_template.saved", out.fromId, null, { switches: Object.keys(out.modules).length });
  res.json({ fromId: out.fromId, fromName: out.fromName, savedAt: out.savedAt, savedBy: out.savedBy, switches: Object.keys(out.modules).length });
});
router.post("/v1/platform/organizations/:id/apply-setup", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const id = String(req.params.id);
  const out = await applySetupTemplate(id);
  if ("error" in out) { res.status(out.status).json({ error: out.error }); return; }
  await platformAudit(owner.name, "setup_template.applied", id, out.before, out.after);
  res.json({ applied: true, switches: out.switches });
});

// The price of each pilot option (60 days, 90 days, 1 year).
router.get("/v1/platform/pilot-prices", requirePlatformOwner, async (_req, res) => { res.json(await getPilotPrices()); });
router.put("/v1/platform/pilot-prices", requirePlatformOwner, async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const out = await savePilotPrices((req.body ?? {}) as Record<string, unknown>, owner.name);
  if ("error" in out) { res.status(400).json(out); return; }
  res.json(out);
});

// Pilot program: 60 days, 90 days or 1 year with every feature on (Platform -> Modules).
router.post("/v1/platform/organizations/:id/pilot", async (req, res) => {
  const id = String(req.params.id);
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  await expirePilots().catch(() => 0);
  const out = b["action"] === "start"
    ? await startPilot(id, Number(b["days"]), (b["modules"] && typeof b["modules"] === "object" ? b["modules"] : {}) as Record<string, boolean>, owner.name)
    : b["action"] === "purchase" ? await purchasePilot(id, owner.name)
    : b["action"] === "end" ? await endPilot(id, owner.name)
    : b["action"] === "paid" ? await setPilotPaid(id, b["amount"], owner.name)
    : b["action"] === "refunded" ? await markPilotRefunded(id, owner.name)
    : { error: "Unknown pilot action" };
  if ("error" in out) { res.status(400).json(out); return; }
  res.json(out);
});

router.patch("/v1/platform/organizations/:id/deletion-policy", async (req, res) => {
  const id = req.params.id;
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "Deletion setting is required" });
    return;
  }
  const [before] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!before) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const features = before.features && typeof before.features === "object" && !Array.isArray(before.features)
    ? { ...before.features, deletionEnabled: enabled }
    : { deletionEnabled: enabled };
  const [organization] = await db
    .update(organizations)
    .set({ features, updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "organization.deletion_policy_updated", id, before, organization);
  res.json({ enabled });
});

router.patch("/v1/platform/organizations/:id", async (req, res) => {
  const id = req.params.id;
  const body = req.body as Record<string, unknown>;
  if (id === "default" && Object.keys(body).some((key) => key !== "features")) {
    res.status(400).json({ error: "Default organization settings cannot be modified" });
    return;
  }
  const [before] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!before) { res.status(404).json({ error: "Organization not found" }); return; }
  const allowed = ["name", "status", "startsAt", "endsAt", "staffLimit", "propertyLimit", "licensedUnits", "hrEmail", "features", "unrestricted"] as const;
  if (Object.keys(body).some((key) => !allowed.includes(key as typeof allowed[number]))) { res.status(400).json({ error: "Unknown organization field" }); return; }
  const updates: Partial<typeof organizations.$inferInsert> = {};
  if ("name" in body) { if (typeof body["name"] !== "string" || !body["name"].trim()) { res.status(400).json({ error: "Organization name is required" }); return; } updates.name = body["name"].trim(); }
  if ("status" in body) updates.status = body["status"] as string;
  if (updates.status && !["active", "suspended", "expired"].includes(updates.status)) {
    res.status(400).json({ error: "Invalid organization status" }); return;
  }
  for (const key of ["startsAt", "endsAt"] as const) if (key in body) { const value = body[key] == null ? null : new Date(String(body[key])); if (value && Number.isNaN(value.getTime())) { res.status(400).json({ error: "Invalid date" }); return; } updates[key] = value; }
  for (const key of ["staffLimit", "propertyLimit", "licensedUnits"] as const) if (key in body) { const value = body[key]; if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) { res.status(400).json({ error: "Invalid limit" }); return; } updates[key] = value as number | null; }
  if ("hrEmail" in body) {
    const hrEmail = normalizeHrEmail(body["hrEmail"]);
    if (!hrEmail) { res.status(400).json({ error: "A valid HR email is required" }); return; }
    updates.hrEmail = hrEmail;
  }
  if ("features" in body) {
    if (!body["features"] || typeof body["features"] !== "object" || Array.isArray(body["features"])) {
      res.status(400).json({ error: "Invalid features" });
      return;
    }
    updates.features = mergeTimeClockConfig(body["features"], { integrationEnabled: false, provider: null });
  }
  const effectiveName = updates.name ?? before.name;
  const effectiveFeatures = updates.features ?? before.features;
  updates.features = addOrganizationNameForDevelopmentType(effectiveFeatures, effectiveName);
  if ("unrestricted" in body) { if (typeof body["unrestricted"] !== "boolean") { res.status(400).json({ error: "Invalid unrestricted flag" }); return; } updates.unrestricted = body["unrestricted"]; }
  const effectiveStartsAt = "startsAt" in updates ? updates.startsAt : before.startsAt;
  let effectiveEndsAt = "endsAt" in updates ? updates.endsAt : before.endsAt;
  if (updates.status === "active" && effectiveEndsAt && effectiveEndsAt <= new Date()) {
    updates.endsAt = null;
    effectiveEndsAt = null;
  }
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

    await tx.execute(sql`delete from refresh_sessions where staff_id in (select id from staff_accounts where tenant_id = ${id})`);
    await tx.execute(sql`delete from time_clock_punches where tenant_id = ${id}`);
    await tx.execute(sql`delete from vendor_walkthrough_check_ins where tenant_id = ${id}`);
    await tx.execute(sql`delete from public_access_codes where tenant_id = ${id}`);
    await tx.execute(sql`delete from resident_report_photos where tenant_id = ${id}`);
    await tx.execute(sql`delete from resident_photo_upload_grants where tenant_id = ${id}`);
    await tx.execute(sql`delete from file_ownership where tenant_id = ${id}`);
    await tx.execute(sql`delete from entity_records where tenant_id = ${id}`);
    await tx.execute(sql`delete from notifications where tenant_id = ${id}`);
    await tx.execute(sql`delete from audit_log where tenant_id = ${id}`);
    await tx.execute(sql`delete from settings where tenant_id = ${id}`);
    await tx.execute(sql`delete from device_tokens where tenant_id = ${id}`);
    // The client's Command Center (its audit rows stay: the trail is append-only).
    for (const t of ["command_devices", "command_agents", "command_runs", "command_actions", "command_work_orders"]) {
      await tx.execute(sql`delete from ${sql.identifier(t)} where tenant_id = ${id}`);
    }
    // Its buildings on FIAREP's watch list, and the alerts found on them (kept under FIAREP's own tenant).
    await tx.execute(sql`delete from entity_records where entity = 'violation-alerts' and state->>'watchId' in (select id from entity_records where entity = 'watch-buildings' and state->>'organizationId' = ${id})`);
    await tx.execute(sql`delete from entity_records where entity = 'watch-buildings' and state->>'organizationId' = ${id}`);
    await tx.delete(organizationProperties).where(eq(organizationProperties.organizationId, id));
    await tx.delete(staffAccounts).where(eq(staffAccounts.tenantId, id));
    await tx.delete(organizations).where(eq(organizations.id, id));
    return organization;
  });

  if (!deleted) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const owner = res.locals["platformOwner"] as { name: string };
  await platformAudit(owner.name, "organization.deleted", id, deleted, null);
  res.status(204).send();
});

export default router;