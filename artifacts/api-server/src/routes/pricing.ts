// Owner-set prices. The price book, the pricing ladder bands and the plan
// figures ship with defaults in the web app; the platform owner can change any
// number here and the change applies everywhere the number is read — Platform
// Control price book, contracts, job-request prefill, the public plan card and
// the public estimate table. Clients never see the price book itself.
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";
import { repairCatalog } from "../lib/repairCatalog";

const router: IRouter = Router();
const ENTITY = "pricing-overrides";
const ID = "pricing-overrides";

type Band = { label: string; from: number; to: number; platformRate: number | null; platformMin: number | null; planRate: number | null; planMin: number | null; note?: string; hoursPerUnit?: number | null; maintRate?: number | null; maintMin?: number | null; v?: number };
type Overrides = { items: Record<string, number>; bands: Band[] | null; updatedAt: string | null; updatedBy: string | null };

const EMPTY: Overrides = { items: {}, bands: null, updatedAt: null, updatedBy: null };

async function load(): Promise<Overrides> {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, ID), eq(entityRecords.entity, ENTITY))).limit(1);
  if (!row) return EMPTY;
  const s = (row.state ?? {}) as Partial<Overrides>;
  return { items: s.items && typeof s.items === "object" ? s.items : {}, bands: Array.isArray(s.bands) ? s.bands : null, updatedAt: row.updatedAt?.toISOString() ?? null, updatedBy: row.createdBy ?? null };
}

const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };

function cleanItems(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(k)) continue;
    const n = num(raw); if (n != null) out[k] = n;
  }
  return out;
}
function cleanBands(v: unknown): Band[] | null {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > 12) return null;
  const out: Band[] = [];
  for (const b of v as Record<string, unknown>[]) {
    if (!b || typeof b !== "object") return null;
    const from = num(b["from"]), to = num(b["to"]);
    if (from == null || to == null || to < from) return null;
    // Any price may be left blank: the owner types the ones he wants.
    const pr = b["platformRate"] == null ? null : num(b["platformRate"]);
    const pm = b["platformMin"] == null ? null : num(b["platformMin"]);
    const planRate = b["planRate"] == null ? null : num(b["planRate"]);
    const planMin = b["planMin"] == null ? null : num(b["planMin"]);
    const hoursPerUnit = b["hoursPerUnit"] == null ? null : num(b["hoursPerUnit"]);
    const maintRate = b["maintRate"] == null ? null : num(b["maintRate"]);
    const maintMin = b["maintMin"] == null ? null : num(b["maintMin"]);
    const note = typeof b["note"] === "string" ? (b["note"] as string).slice(0, 500) : undefined;
    out.push({ label: String(b["label"] ?? `${from}–${to}`).slice(0, 40), from, to, platformRate: pr, platformMin: pm, planRate, planMin, hoursPerUnit, maintRate, maintMin, ...(note !== undefined ? { note } : {}), ...(b["v"] === 2 ? { v: 2 } : {}) });
  }
  return out;
}

// Public: the web app reads this on load so every price it shows is the owner's current number.
// Never cached. A price the owner just changed must not come back from a
// browser or edge cache on the public Join page.
router.get("/v1/pricing", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const current = await load();
  // The catalogue rides along: the phone has no price book of its own, and a
  // quote line must be priced by the server rather than by whatever the phone
  // sends.
  res.json({ ...current, catalog: repairCatalog(current.items) });
});

router.put("/v1/platform/pricing", requirePlatformOwner, async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const current = await load();
  const items = "items" in b ? cleanItems(b["items"]) : current.items;
  const bands = "bands" in b ? cleanBands(b["bands"]) : current.bands;
  // A bad band is refused, never saved as "no bands" (that would wipe the owner's ladder).
  if ("bands" in b && b["bands"] != null && bands == null) { res.status(400).json({ error: "A band is not valid — check each band's start and end." }); return; }
  const now = new Date();
  const state = { items, bands };
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, ID), eq(entityRecords.entity, ENTITY))).limit(1);
  if (row) await db.update(entityRecords).set({ state, createdBy: owner.name, updatedAt: now }).where(eq(entityRecords.id, ID));
  else await db.insert(entityRecords).values({ id: ID, tenantId: "default", entity: ENTITY, development: "FIAREP pricing", state, createdBy: owner.name, createdAt: now, updatedAt: now });
  await platformAudit(owner.name, "pricing.updated", ID, { items: current.items, bands: current.bands }, state);
  res.json({ items, bands, updatedAt: now.toISOString(), updatedBy: owner.name });
});

export default router;
