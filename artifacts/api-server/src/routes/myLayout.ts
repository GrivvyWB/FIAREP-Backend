// Each person's own arrangement: the order of the website's side menu and of
// the tiles and sections on their app home. Moved on the screen itself; kept
// on the server so it is the same on every device they sign in on.
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const ENTITY = "layout-prefs";
const idFor = (staffId: string) => `layout-${staffId}`;
const strings = (v: unknown, max = 300) => (Array.isArray(v) ? v.map((x) => String(x ?? "").slice(0, 120)).filter(Boolean).slice(0, max) : []);

router.get("/v1/me/layout", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, idFor(actor.id)), eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.entity, ENTITY),
  )).limit(1);
  res.setHeader("Cache-Control", "no-store");
  res.json(row?.state ?? {});
});

/** { web?: string[] } — the menu's hrefs in order; { app?: { [screen]: [{ heading, tiles: string[] }] } } — a home's sections and tiles in order. Null resets. */
router.put("/v1/me/layout", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, idFor(actor.id)), eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.entity, ENTITY),
  )).limit(1);
  const state: Record<string, unknown> = { ...(row?.state ?? {}) };
  if ("web" in body) { if (body["web"] === null) delete state["web"]; else state["web"] = strings(body["web"]); }
  if ("app" in body && body["app"] && typeof body["app"] === "object") {
    const app = { ...((state["app"] as Record<string, unknown>) ?? {}) };
    for (const [screen, secs] of Object.entries(body["app"] as Record<string, unknown>).slice(0, 20)) {
      const key = String(screen).slice(0, 80);
      if (secs === null) { delete app[key]; continue; }
      app[key] = (Array.isArray(secs) ? secs : []).slice(0, 40).map((s) => ({
        heading: String((s as Record<string, unknown>)?.["heading"] ?? "").slice(0, 80),
        tiles: strings((s as Record<string, unknown>)?.["tiles"], 200),
      }));
    }
    state["app"] = app;
  }
  const now = new Date();
  if (row) {
    await db.update(entityRecords).set({ state, version: (row.version ?? 1) + 1, updatedAt: now })
      .where(and(eq(entityRecords.id, row.id), eq(entityRecords.tenantId, actor.tenantId)));
  } else {
    await db.insert(entityRecords).values({ id: idFor(actor.id), tenantId: actor.tenantId, entity: ENTITY, version: 1, state, createdBy: actor.id, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
  }
  res.json(state);
});

export default router;
