import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, organizations, timeClockLocations, timeClockPunches } from "@workspace/db";
import { reverseGeocodeNyc } from "../lib/nycProperty";
import { actorFrom, requireAuth } from "../middlewares/auth";
import {
  expectedDirection,
  classifyMobileIdempotency,
  getLatestPunch,
  getTimeClockConfig,
  isMobileClockMutationAllowed,
  serializeTimeClockPunch,
} from "../lib/timeClock";

const router: IRouter = Router();
router.use("/v1/time-clock", requireAuth);

type Loc = { latitude: number; longitude: number; accuracyM: number | null };
/** Optional {latitude, longitude, accuracy} from the phone / browser. */
function locationOf(body: unknown): Loc | null {
  const v = body && typeof body === "object" ? (body as Record<string, unknown>)["location"] : null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o["latitude"]), lng = Number(o["longitude"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const acc = Number(o["accuracyM"] ?? o["accuracy"]);
  return { latitude: lat, longitude: lng, accuracyM: Number.isFinite(acc) ? acc : null };
}
const withPlace = (row: { latitude: number | null; longitude: number | null; accuracyM: number | null; address: string | null }) => ({
  location: row.latitude != null && row.longitude != null ? { latitude: row.latitude, longitude: row.longitude, accuracyM: row.accuracyM, address: row.address } : null,
});

async function tenantConfig(tenantId: string) {
  const [organization] = await db.select({ features: organizations.features })
    .from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  return getTimeClockConfig(organization?.features);
}

router.get("/v1/time-clock/status", async (_req, res) => {
  const actor = actorFrom(res);
  const [latest, config] = await Promise.all([
    getLatestPunch(actor.tenantId, actor.id),
    tenantConfig(actor.tenantId),
  ]);
  res.json({
    config: {
      integrationEnabled: config.integrationEnabled,
      externalAuthoritative: config.externalAuthoritative,
      mobileClockEnabled: config.mobileClockEnabled,
      provider: config.provider,
    },
    current: latest ? serializeTimeClockPunch(latest) : null,
    nextDirection: expectedDirection(latest ? { direction: latest.direction as "in" | "out" } : null),
  });
});

router.get("/v1/time-clock/history", async (req, res) => {
  const actor = actorFrom(res);
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 50));
  const rows = await db.select().from(timeClockPunches).where(and(
    eq(timeClockPunches.tenantId, actor.tenantId),
    eq(timeClockPunches.staffId, actor.id),
  )).orderBy(desc(timeClockPunches.punchAt), desc(timeClockPunches.recordedAt)).limit(limit);
  res.json(rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    source: row.source,
    punchAt: row.punchAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    provider: row.provider,
    externalId: row.externalId,
    readOnly: row.source === "external",
    ...withPlace(row),
  })));
});

router.post("/v1/time-clock/punch", async (req, res) => {
  const actor = actorFrom(res);
  const direction = req.body?.direction;
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (direction !== "in" && direction !== "out") {
    res.status(400).json({ error: "direction must be in or out" });
    return;
  }
  if (!idempotencyKey) {
    res.status(400).json({ error: "idempotencyKey is required" });
    return;
  }
  const loc = locationOf(req.body);
  const address = loc ? await reverseGeocodeNyc(loc.latitude, loc.longitude) : null;
  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.select({ features: organizations.features })
      .from(organizations)
      .where(eq(organizations.id, actor.tenantId))
      .limit(1)
      .for("update");
    if (!organization) return { missingOrganization: true } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`time-clock:${actor.tenantId}:${actor.id}`}))`);
    const config = getTimeClockConfig(organization.features);
    const [existing] = await tx.select().from(timeClockPunches).where(and(
      eq(timeClockPunches.tenantId, actor.tenantId),
      eq(timeClockPunches.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (classifyMobileIdempotency(existing, actor.id, direction) === "conflict") {
        return { keyConflict: true } as const;
      }
      return { row: existing } as const;
    }
    if (!isMobileClockMutationAllowed(config)) return { disabled: true } as const;
    const [latest] = await tx.select().from(timeClockPunches).where(and(
      eq(timeClockPunches.tenantId, actor.tenantId),
      eq(timeClockPunches.staffId, actor.id),
    )).orderBy(desc(timeClockPunches.punchAt), desc(timeClockPunches.recordedAt)).limit(1);
    const expected = expectedDirection(latest ? { direction: latest.direction as "in" | "out" } : null);
    if (direction !== expected) return { conflict: expected } as const;
    const now = new Date();
    const [row] = await tx.insert(timeClockPunches).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      staffId: actor.id,
      source: "fiarep-mobile",
      direction,
      punchAt: now,
      recordedAt: now,
      provider: null,
      externalId: null,
      idempotencyKey,
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      accuracyM: loc?.accuracyM ?? null,
      address,
    }).returning();
    // Punching out closes any open stop.
    if (direction === "out") await tx.update(timeClockLocations).set({ leftAt: now, updatedAt: now }).where(and(eq(timeClockLocations.tenantId, actor.tenantId), eq(timeClockLocations.staffId, actor.id), isNull(timeClockLocations.leftAt)));
    return { row } as const;
  });
  if ("missingOrganization" in result) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  if ("disabled" in result) {
    res.status(403).json({ error: "FIAREP mobile clock is disabled for this organization" });
    return;
  }
  if ("keyConflict" in result) {
    res.status(409).json({ error: "idempotencyKey was already used for the opposite punch direction" });
    return;
  }
  if ("conflict" in result) {
    res.status(409).json({ error: `The next punch must be ${result.conflict}` });
    return;
  }
  const row = result.row;
  res.status(201).json({ ...serializeTimeClockPunch(row), ...withPlace(row) });
});

// ---- Where a clocked-in person has been -------------------------------------
// The phone decides when a stop is real (moved, then stayed put for 30 minutes)
// and reports it; the server keeps the list. Punching out closes the open stop.
const serializeStop = (r: typeof timeClockLocations.$inferSelect) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, accuracyM: r.accuracyM, address: r.address, arrivedAt: r.arrivedAt.toISOString(), leftAt: r.leftAt ? r.leftAt.toISOString() : null });

router.get("/v1/time-clock/locations", async (req, res) => {
  const actor = actorFrom(res);
  const from = new Date(String(req.query["from"] || "")); const to = new Date(String(req.query["to"] || ""));
  const conds = [eq(timeClockLocations.tenantId, actor.tenantId), eq(timeClockLocations.staffId, actor.id)];
  if (!Number.isNaN(from.getTime())) conds.push(gte(timeClockLocations.arrivedAt, from));
  if (!Number.isNaN(to.getTime())) conds.push(lte(timeClockLocations.arrivedAt, to));
  const rows = await db.select().from(timeClockLocations).where(and(...conds)).orderBy(desc(timeClockLocations.arrivedAt)).limit(300);
  res.json(rows.map(serializeStop));
});

router.post("/v1/time-clock/locations", async (req, res) => {
  const actor = actorFrom(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const loc = locationOf({ location: body["location"] ?? body });
  const idempotencyKey = typeof body["idempotencyKey"] === "string" ? body["idempotencyKey"].trim() : "";
  const arrivedAt = new Date(String(body["arrivedAt"] || ""));
  if (!loc || !idempotencyKey || Number.isNaN(arrivedAt.getTime())) { res.status(400).json({ error: "location, arrivedAt and idempotencyKey are required" }); return; }
  const [latest] = await db.select().from(timeClockPunches).where(and(eq(timeClockPunches.tenantId, actor.tenantId), eq(timeClockPunches.staffId, actor.id))).orderBy(desc(timeClockPunches.punchAt)).limit(1);
  if (!latest || latest.direction !== "in") { res.status(409).json({ error: "Not clocked in — locations are only kept while on the clock" }); return; }
  const [existing] = await db.select().from(timeClockLocations).where(and(eq(timeClockLocations.tenantId, actor.tenantId), eq(timeClockLocations.idempotencyKey, idempotencyKey))).limit(1);
  if (existing) { res.json(serializeStop(existing)); return; }
  const now = new Date();
  const address = await reverseGeocodeNyc(loc.latitude, loc.longitude);
  // Arriving somewhere new means the previous stop is over.
  await db.update(timeClockLocations).set({ leftAt: arrivedAt, updatedAt: now }).where(and(eq(timeClockLocations.tenantId, actor.tenantId), eq(timeClockLocations.staffId, actor.id), isNull(timeClockLocations.leftAt)));
  const [row] = await db.insert(timeClockLocations).values({ id: randomUUID(), tenantId: actor.tenantId, staffId: actor.id, latitude: loc.latitude, longitude: loc.longitude, accuracyM: loc.accuracyM, address, arrivedAt, leftAt: null, idempotencyKey, createdAt: now, updatedAt: now } as typeof timeClockLocations.$inferInsert).returning();
  res.status(201).json(serializeStop(row!));
});

router.post("/v1/time-clock/locations/:id/leave", async (req, res) => {
  const actor = actorFrom(res);
  const leftAt = new Date(String((req.body as Record<string, unknown>)?.["leftAt"] || "")); const at = Number.isNaN(leftAt.getTime()) ? new Date() : leftAt;
  const [row] = await db.update(timeClockLocations).set({ leftAt: at, updatedAt: new Date() }).where(and(eq(timeClockLocations.id, req.params.id!), eq(timeClockLocations.tenantId, actor.tenantId), eq(timeClockLocations.staffId, actor.id), isNull(timeClockLocations.leftAt))).returning();
  if (!row) { res.status(404).json({ error: "No open stop with that id" }); return; }
  res.json(serializeStop(row));
});

export default router;