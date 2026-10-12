import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  LookupNycPropertyQueryParams,
  LookupNycPropertyResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePlatformOwner } from "../middlewares/auth";
import { lookupNycPropertyData } from "../lib/nycProperty";
import { lookupDofCharges, lookupBuildingUnits } from "../lib/dofCharges";
import { rateLimit } from "../lib/rateLimit";
import { platformAudit } from "../lib/audit";
import { db, organizationProperties, organizations } from "@workspace/db";

const router: IRouter = Router();

// ── Public (used on the Join page): what a building owes the City ──
router.get("/v1/public/dof-charges", rateLimit("dof-charges", 30), async (req, res): Promise<void> => {
  const address = String(req.query["address"] ?? "").trim().slice(0, 200);
  res.setHeader("Cache-Control", "no-store");
  if (address.length < 4) { res.status(400).json({ error: "Enter a building address." }); return; }
  try {
    const result = await lookupDofCharges(address);
    if (!result) { res.status(404).json({ error: "That address could not be matched to an NYC property." }); return; }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data is temporarily unavailable." });
  }
});

router.get("/v1/property/nyc-lookup", requireAuth, async (req, res): Promise<void> => {
  const parsed = LookupNycPropertyQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid NYC street address." });
    return;
  }
  try {
    const result = await lookupNycPropertyData(parsed.data.address, parsed.data.limit);
    if (!result) {
      res.status(404).json({ error: "That address could not be matched to an NYC property." });
      return;
    }
    res.json(LookupNycPropertyResponse.parse(result));
  } catch (error) {
    req.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "NYC property lookup failed",
    );
    res.status(502).json({ error: "NYC property records are temporarily unavailable." });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Platform Control: the owner registers each client's buildings.
// Clients never manage their own properties. FIAREP decides which
// buildings an organization is responsible for and which of them are on
// the plan — "on the plan" drives licensed-unit billing, resident
// complaint routing (residentRouting) and public resident access
// (publicAccess), so it stays with the owner.
// ═══════════════════════════════════════════════════════════════════

router.use("/v1/platform/properties", requirePlatformOwner);

const ownerName = (res: import("express").Response) =>
  (res.locals["platformOwner"] as { name: string } | undefined)?.name ?? "platform";

// ── Address autocomplete (NYC Planning Labs) ──
const GEOSEARCH_AUTOCOMPLETE = "https://geosearch.planninglabs.nyc/v2/autocomplete";

router.get("/v1/platform/properties/address-suggest", rateLimit("address-suggest", 60), async (req, res): Promise<void> => {
  const q = String(req.query["q"] ?? "").trim();
  if (q.length < 3) { res.json([]); return; }
  try {
    const url = new URL(GEOSEARCH_AUTOCOMPLETE);
    url.searchParams.set("text", q);
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json", "user-agent": "FIAREP/1.0" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) { res.json([]); return; }
    const data = (await response.json()) as { features?: Array<{ properties?: Record<string, unknown> }> };
    const suggestions = (data.features || [])
      .filter((f) => f.properties?.housenumber && f.properties?.street)
      .slice(0, 8)
      .map((f) => {
        const p = f.properties!;
        return {
          address: `${p.housenumber} ${p.street}`,
          borough: String(p.borough ?? ""),
          label: String(p.label ?? `${p.housenumber} ${p.street}`),
        };
      });
    res.json(suggestions);
  } catch {
    res.json([]);
  }
});

// ── One organization's buildings, with its unit budget ──
router.get("/v1/platform/properties", async (req, res): Promise<void> => {
  const organizationId = String(req.query["organizationId"] ?? "").trim();
  if (!organizationId) { res.status(400).json({ error: "Pick an organization." }); return; }
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) { res.status(404).json({ error: "Organization not found." }); return; }
  const rows = await db.select().from(organizationProperties)
    .where(eq(organizationProperties.organizationId, organizationId))
    .orderBy(organizationProperties.displayAddress);
  res.json({
    properties: rows,
    organizationName: org.name,
    licensedUnits: org.licensedUnits ?? null,
    unrestricted: org.unrestricted === true,
  });
});

// ── Register a building for a client ──
router.post("/v1/platform/properties", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const organizationId = String(body["organizationId"] ?? "").trim();
  const displayAddress = String(body["displayAddress"] ?? "").trim();
  const development = typeof body["development"] === "string" ? body["development"].trim() || null : null;
  if (!organizationId) { res.status(400).json({ error: "Pick an organization." }); return; }
  if (!displayAddress || displayAddress.length < 4) {
    res.status(400).json({ error: "Enter a building address." }); return;
  }
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) { res.status(404).json({ error: "Organization not found." }); return; }
  const normalizedAddress = displayAddress.toLowerCase().replace(/\s+/g, " ");
  try {
    // City unit lookup
    let units = 0; let bbl: string | null = null;
    try {
      const found = await lookupBuildingUnits(displayAddress);
      if (found) { units = found.units; bbl = found.bbl; }
    } catch { /* City lookup unavailable */ }
    const typedUnits = Number.isInteger(body["units"]) && (body["units"] as number) > 0 ? (body["units"] as number) : 0;
    if (units <= 0) units = typedUnits;
    // Same-lot check: second address on a BBL already registered gets 0 units
    if (bbl) {
      const sameLot = await db.select({ id: organizationProperties.id }).from(organizationProperties)
        .where(and(eq(organizationProperties.organizationId, organizationId), eq(organizationProperties.bbl, bbl))).limit(1);
      if (sameLot.length > 0) units = 0;
    }
    // Not on the plan by default — the owner switches it on separately.
    const active = body["active"] === true;
    const [created] = await db.insert(organizationProperties).values({
      id: randomUUID(),
      organizationId,
      displayAddress,
      normalizedAddress,
      development,
      units: units > 0 ? units : null,
      bbl,
      active,
    }).returning();
    await platformAudit(ownerName(res), "property.added", organizationId, null, { address: displayAddress, units, active });
    res.status(201).json(created);
  } catch (error: any) {
    if (error?.code === "23505") { res.status(409).json({ error: "That address is already registered for this organization." }); return; }
    throw error;
  }
});

// ── Switch a building on / off the plan, or rename its development ──
router.patch("/v1/platform/properties/:id", async (req, res): Promise<void> => {
  const [existing] = await db.select().from(organizationProperties)
    .where(eq(organizationProperties.id, String(req.params.id))).limit(1);
  if (!existing) { res.status(404).json({ error: "Property not found." }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body["active"] === "boolean") patch["active"] = body["active"];
  if (typeof body["development"] === "string") patch["development"] = body["development"].trim() || null;
  if (Object.keys(patch).length === 0) { res.json(existing); return; }
  // Switching ON is held to the organization's licensed units. Raise the
  // organization's plan first if a building would push it over.
  if (patch["active"] === true && !existing.active) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, existing.organizationId)).limit(1);
    if (org?.licensedUnits && !org.unrestricted && existing.units) {
      const rows = await db.select({ units: organizationProperties.units }).from(organizationProperties)
        .where(and(eq(organizationProperties.organizationId, existing.organizationId), eq(organizationProperties.active, true)));
      const registered = rows.reduce((n, r) => n + (r.units || 0), 0);
      if (registered + existing.units > org.licensedUnits) {
        res.status(403).json({ error: `This building (${existing.units} units) would put ${org.name} over its licensed ${org.licensedUnits} units. Raise the organization's plan first.` }); return;
      }
    }
  }
  const [updated] = await db.update(organizationProperties)
    .set({ ...patch, updatedAt: new Date() } as any)
    .where(eq(organizationProperties.id, existing.id))
    .returning();
  await platformAudit(
    ownerName(res),
    patch["active"] === true ? "property.activated" : patch["active"] === false ? "property.deactivated" : "property.updated",
    existing.organizationId,
    { address: existing.displayAddress, active: existing.active, development: existing.development },
    { address: existing.displayAddress, active: updated?.active, development: updated?.development },
  );
  res.json(updated);
});

// ── Remove a building from a client's list ──
router.delete("/v1/platform/properties/:id", async (req, res): Promise<void> => {
  const [existing] = await db.select().from(organizationProperties)
    .where(eq(organizationProperties.id, String(req.params.id))).limit(1);
  if (!existing) { res.status(404).json({ error: "Property not found." }); return; }
  await db.delete(organizationProperties).where(eq(organizationProperties.id, existing.id));
  await platformAudit(ownerName(res), "property.removed", existing.organizationId, { address: existing.displayAddress, active: existing.active }, null);
  res.status(204).send();
});

export default router;
