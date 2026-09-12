import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, organizations, timeClockPunches } from "@workspace/db";
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
    }).returning();
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
  res.status(201).json(serializeTimeClockPunch(row));
});

export default router;