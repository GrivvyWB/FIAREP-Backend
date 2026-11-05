// Lotto Generator app: new draws since a date. Public and read-only, open to the app from any origin.
import { Router } from "express";
import { lottoSince, lottoTick } from "../lib/lotto";

const router = Router();
router.get("/", async (req, res) => {
  lottoTick();
  try {
    res.set("cache-control", "public, max-age=600");
    res.json(await lottoSince(String(req.query["since"] ?? "")));
  } catch {
    res.status(503).json({ error: "Not available right now" });
  }
});
// CT Keno: the latest real draws from the CT Lottery's own results (draws every 4 minutes), for the app's results screen.
let ctKeno: { at: number; body: unknown } | null = null;
router.get("/ct-keno", async (_req, res) => {
  try {
    if (!ctKeno || Date.now() - ctKeno.at > 60_000) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const r = await fetch(`https://ctlottery.com/api/winning-numbers?game=keno&date=${today}&limit=400`, { headers: { "user-agent": "Mozilla/5.0 (compatible; FIAREP lotto updater)", accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { draws?: { drawDate?: string; drawId?: string; whiteBalls?: number[]; multiplier?: number | null }[] };
      const draws = (j.draws || []).filter((d) => Array.isArray(d.whiteBalls) && d.whiteBalls.length === 20)
        .map((d) => ({ id: String(d.drawId || ""), date: String(d.drawDate || today), numbers: d.whiteBalls!.map(Number).sort((a, b) => a - b), multiplier: d.multiplier ?? null }))
        .sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 40);
      ctKeno = { at: Date.now(), body: { draws, updatedAt: new Date().toISOString() } };
    }
    res.set("cache-control", "public, max-age=60");
    res.json(ctKeno.body);
  } catch {
    res.status(503).json({ error: "Not available right now" });
  }
});
export default router;
