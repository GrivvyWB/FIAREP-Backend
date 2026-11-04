// Lotto Generator app: new winning numbers for every area it covers, kept on the FIAREP server.
// The app ships with 16 years of draws; this adds each new draw after that. NY's own games and
// the national games come from NY State Open Data (data.ny.gov); every other state's games come
// from lottery.net, one page at a time, a few seconds apart. Quick Draw is kept as daily totals.
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";

const PLATFORM = "default";
const KEY = "lotto-draws";
/** Draws on or after this date are kept (the app already has everything before it). */
const FROM = "2026-10-25";
/** Quick Draw days after this are added (the app's totals run through this day). */
const KENO_AFTER = "2026-11-02";
const GAP_MS = 4_000;

type Row = [string, number[], number[]];
type Store = {
  hist: Record<string, Row[]>;
  keno: Record<string, number[]>; // day → [draws, count of 1 … count of 80]
  lastRun?: { startedAt: string; finishedAt?: string; added: Record<string, number>; failed: Record<string, string> };
};

// key → [state page path(s) on lottery.net, main balls, bonus balls]
const LN: Record<string, [string[], number, number]> = {
  "CA|SuperLotto Plus": [["california/superlotto-plus"], 5, 1],
  "CA|Fantasy 5": [["california/fantasy-5"], 5, 0],
  "FL|Florida Lotto": [["florida/lotto"], 6, 0],
  "FL|Jackpot Triple Play": [["florida/jackpot-triple-play"], 6, 0],
  "FL|Fantasy 5": [["florida/fantasy-5-midday", "florida/fantasy-5-evening"], 5, 0],
  "FL|Pick 5": [["florida/pick-5-midday", "florida/pick-5-evening"], 5, 1],
  "GA|Fantasy 5": [["georgia/fantasy-5"], 5, 0],
  "GA|Georgia FIVE": [["georgia/five-midday", "georgia/five-evening"], 5, 0],
  "IL|Lotto": [["illinois/lotto"], 6, 1],
  "IL|Lucky Day Lotto": [["illinois/lucky-day-lotto-midday", "illinois/lucky-day-lotto-evening"], 5, 0],
  "TX|Lotto Texas": [["texas/lotto"], 6, 0],
  "TX|Cash Five": [["texas/cash-five"], 5, 0],
  "MI|Fantasy 5": [["michigan/fantasy-5"], 5, 0],
  "MI|Lotto 47": [["michigan/lotto-47"], 6, 0],
  "MI|Daily 5": [["michigan/daily-5-midday", "michigan/daily-5-evening"], 5, 0],
  "MN|Gopher 5": [["minnesota/gopher-5"], 5, 0],
  "MN|North 5": [["minnesota/north-5"], 5, 0],
  "NJ|Pick-6": [["new-jersey/pick-6"], 6, 0],
  "NJ|Jersey Cash 5": [["new-jersey/cash-5"], 5, 1],
  "OH|Classic Lotto": [["ohio/classic-lotto"], 6, 0],
  "OH|Rolling Cash 5": [["ohio/rolling-cash-5"], 5, 0],
  "OH|Pick 5": [["ohio/pick-5-midday", "ohio/pick-5-evening"], 5, 0],
  "VA|Bank a Million": [["virginia/bank-a-million"], 6, 1],
  "VA|Cash 5": [["virginia/cash-5"], 5, 0],
  "VA|Pick 5": [["virginia/pick-5-day", "virginia/pick-5-night"], 5, 1],
  "CT|Play3": [["connecticut/play-3-day", "connecticut/play-3-night"], 3, 0],
  "CT|Play4": [["connecticut/play-4-day", "connecticut/play-4-night"], 4, 0],
  "CT|Cash5": [["connecticut/cash-5"], 5, 0],
  "CT|Lotto!": [["connecticut/lotto"], 6, 0],
  "MD|Bonus Match 5": [["maryland/bonus-match-5"], 5, 1],
  "MD|Multi-Match": [["maryland/multi-match"], 6, 0],
  "MD|Pick 5": [["maryland/pick-5-midday", "maryland/pick-5-evening"], 5, 0],
  "DC|DC 5": [["district-of-columbia/dc-5-midday", "district-of-columbia/dc-5-evening"], 5, 0],
  "AZ|Fantasy 5": [["arizona/fantasy-5"], 5, 0],
  "AZ|Triple Twist": [["arizona/triple-twist"], 6, 0],
  "AZ|The Pick": [["arizona/the-pick"], 6, 0],
  "PA|Cash 5": [["pennsylvania/cash-5"], 5, 0],
  "PA|Match 6": [["pennsylvania/match-6-lotto"], 6, 0],
  "PA|Treasure Hunt": [["pennsylvania/treasure-hunt"], 5, 0],
  "PA|Pick 5": [["pennsylvania/pick-5-day", "pennsylvania/pick-5-evening"], 5, 1],
  "NC|Cash 5": [["north-carolina/cash-5"], 5, 0],
  "WI|Badger 5": [["wisconsin/badger-5"], 5, 0],
  "WI|Megabucks": [["wisconsin/megabucks"], 6, 0],
  "WI|SuperCash!": [["wisconsin/supercash"], 6, 0],
  "CO|Cash 5": [["colorado/cash-5"], 5, 0],
  "CO|Colorado Lotto+": [["colorado/lotto"], 6, 0],
  "TN|Daily Tennessee Jackpot": [["tennessee/daily-jackpot"], 5, 0],
  "MO|Show Me Cash": [["missouri/show-me-cash"], 5, 0],
  "MO|MO Millions": [["missouri/mo-millions"], 5, 1],
  "NM|Roadrunner Cash": [["new-mexico/roadrunner-cash"], 5, 0],
  "SC|Palmetto Cash 5": [["south-carolina/palmetto-cash-5"], 5, 0],
  "OK|Cash 5": [["oklahoma/cash-5"], 5, 0],
  "DE|Multi-Win Lotto": [["delaware/multi-win-lotto"], 6, 0],
  "DE|Play 5": [["delaware/play-5-day", "delaware/play-5-night"], 5, 0],
  "LA|Easy 5": [["louisiana/easy-5"], 5, 0],
  "LA|Lotto": [["louisiana/lotto"], 6, 0],
  "LA|Pick 5": [["louisiana/pick-5"], 5, 0],
  "MA|Mass Cash": [["massachusetts/mass-cash-midday", "massachusetts/mass-cash-evening"], 5, 0],
  "MA|Megabucks": [["massachusetts/megabucks"], 6, 0],
  "MS|Match 5": [["mississippi/match-5"], 5, 0],
  "WV|Cash 25": [["west-virginia/cash-25"], 6, 0],
  "IN|Hoosier Lotto": [["indiana/hoosier-lotto"], 6, 0],
  "IN|Cash 5": [["indiana/cash-5"], 5, 0],
  "NE|Pick 5": [["nebraska/pick-5"], 5, 0],
  "OR|Megabucks": [["oregon/megabucks"], 6, 0],
  "RI|Wild Money": [["rhode-island/wild-money"], 5, 1],
  "NH|Gimme 5": [["new-hampshire/gimme-5"], 5, 0],
};

const nums = (s: unknown) => String(s ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
const digs = (s: unknown) => String(s ?? "").replace(/\D/g, "").split("").map(Number);
type NyRow = Record<string, string>;
const NY: { key: string; id: string; rows: (r: NyRow) => [number[], number[]][] }[] = [
  { key: "pb", id: "d6yy-54nr", rows: (r) => { const a = nums(r["winning_numbers"]); return [[a.slice(0, 5), a.slice(5, 6)]]; } },
  { key: "mm", id: "5xaw-6ayf", rows: (r) => [[nums(r["winning_numbers"]), [Number(r["mega_ball"])]]] },
  { key: "mfl", id: "a4w9-a3tp", rows: (r) => [[nums(r["winning_numbers"]).slice(0, 5), [Number(r["mill_ball"])]]] },
  { key: "NY|NY Lotto", id: "6nbc-h7bj", rows: (r) => [[nums(r["winning_numbers"]).slice(0, 6), []]] },
  { key: "NY|Take 5", id: "dg63-4siq", rows: (r) => [r["midday_winning_numbers"], r["evening_winning_numbers"]].filter(Boolean).map((x) => [nums(x), []] as [number[], number[]]) },
  { key: "NY|Numbers", id: "hsys-3def", rows: (r) => [r["midday_daily"], r["evening_daily"]].map(digs).filter((a) => a.length === 3).map((a) => [a, []] as [number[], number[]]) },
  { key: "NY|Win 4", id: "hsys-3def", rows: (r) => [r["midday_win_4"], r["evening_win_4"]].map(digs).filter((a) => a.length === 4).map((a) => [a, []] as [number[], number[]]) },
];
const NY_BASE = "https://data.ny.gov/resource/";
const UA = { "user-agent": "Mozilla/5.0 (compatible; FIAREP lotto updater)", accept: "text/html,application/json" };

async function load(): Promise<Store> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, PLATFORM), eq(settings.key, KEY))).limit(1);
  const v = (row?.value || {}) as Partial<Store>;
  return { hist: v.hist || {}, keno: v.keno || {}, lastRun: v.lastRun };
}
async function save(value: Store) {
  const now = new Date();
  await db.insert(settings).values({ tenantId: PLATFORM, key: KEY, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
}

/** Today's date in New York, YYYY-MM-DD. */
function nyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function isoFrom(text: string): string {
  const m = text.toLowerCase().match(/([a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return "";
  const mi = MONTHS.indexOf(m[1]!);
  return mi < 0 ? "" : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/** Draws on one lottery.net year page, shaped to the app's main/bonus ball counts. */
export function parseLotteryNet(html: string, main: number, bonus: number): Row[] {
  const out: Row[] = [];
  const body = html.slice(html.indexOf("<tbody"));
  for (const tr of body.split(/<tr[\s>]/).slice(1)) {
    const td = tr.match(/<td[^>]*class="colour[^"]*"[^>]*>([\s\S]*?)<\/td>/);
    const date = td ? isoFrom(td[1]!.replace(/<[^>]+>/g, " ")) : "";
    if (!date) continue;
    const uls = [...tr.matchAll(/<ul class="balls">([\s\S]*?)<\/ul>/g)].map((u) => [...u[1]!.matchAll(/<li class="([^"]*)">\s*(\d+)\s*<\/li>/g)].map((l) => ({ cls: l[1]!, n: Number(l[2]) })));
    const first = uls[0];
    if (!first || !first.length) continue;
    const isMain = (c: string) => /number-part-|(^|\s)ball$/.test(c.trim());
    let m = first.filter((b) => isMain(b.cls)).map((b) => b.n);
    let b = first.filter((x) => !isMain(x.cls)).map((x) => x.n);
    if (m.length + b.length === main + bonus && (m.length !== main || b.length !== bonus)) { const all = [...m, ...b]; m = all.slice(0, main); b = all.slice(main); }
    if (bonus && !b.length && m.length === main && uls[1]?.length === bonus) b = uls[1].map((x) => x.n);
    if (!bonus && m.length === main) b = []; // a Wild Ball or similar extra is not part of these games' numbers
    if (!first.some((x) => x.cls.includes("number-part-"))) m.sort((x, y) => x - y); // drawn-number games: lowest first, like the app's history
    if (m.length === main && b.length === bonus) out.push([date, m, b]);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running: Promise<Store> | null = null;

/** True while an update is pulling. */
export function lottoUpdating(): boolean { return running !== null; }

function addRows(store: Store, key: string, rows: Row[]): number {
  const have = store.hist[key] || (store.hist[key] = []);
  const seen = new Set(have.map((r) => `${r[0]}|${r[1].join(",")}|${r[2].join(",")}`));
  let n = 0;
  for (const r of rows) {
    if (r[0] < FROM) continue;
    const id = `${r[0]}|${r[1].join(",")}|${r[2].join(",")}`;
    if (seen.has(id)) continue;
    seen.add(id); have.push(r); n++;
  }
  have.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return n;
}

async function pull(): Promise<Store> {
  const store = await load();
  const added: Record<string, number> = {};
  const failed: Record<string, string> = {};
  store.lastRun = { startedAt: new Date().toISOString(), added, failed };
  const today = nyToday();

  for (const f of NY) {
    const h = store.hist[f.key] || [];
    const since = h.length ? h[h.length - 1]![0] : FROM;
    try {
      const res = await fetch(`${NY_BASE}${f.id}.json?$where=${encodeURIComponent(`draw_date>='${since}T00:00:00'`)}&$order=draw_date&$limit=5000`, { headers: UA, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as NyRow[];
      const out: Row[] = [];
      for (const r of rows) { const d = String(r["draw_date"] || "").slice(0, 10); for (const [m, b] of f.rows(r)) if (m.length && m.every(Number.isFinite)) out.push([d, m, b]); }
      added[f.key] = addRows(store, f.key, out);
    } catch (e) { failed[f.key] = e instanceof Error ? e.message : "failed"; }
  }

  // Quick Draw: whole days only (yesterday and before, New York time).
  try {
    const days = Object.keys(store.keno).sort();
    const start = days.length ? days[days.length - 1]! : KENO_AFTER;
    const fresh: Record<string, number[]> = {};
    for (let off = 0; ; ) {
      const res = await fetch(`${NY_BASE}7sqk-ycpk.json?$select=draw_date,winning_numbers&$where=${encodeURIComponent(`draw_date>'${start}T23:59:59' AND draw_date<'${today}T00:00:00'`)}&$order=draw_number&$limit=50000&$offset=${off}`, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as NyRow[];
      for (const r of rows) {
        const d = String(r["draw_date"] || "").slice(0, 10);
        const t = fresh[d] || (fresh[d] = new Array(81).fill(0));
        t[0]++;
        for (const n of nums(r["winning_numbers"])) if (n >= 1 && n <= 80) t[n]++;
      }
      off += rows.length;
      if (rows.length < 50000) break;
    }
    Object.assign(store.keno, fresh);
    added["NY|Quick Draw (days)"] = Object.keys(fresh).length;
  } catch (e) { failed["NY|Quick Draw"] = e instanceof Error ? e.message : "failed"; }
  await save(store);

  const year = Number(today.slice(0, 4));
  for (const [key, [paths, main, bonus]] of Object.entries(LN)) {
    const h = store.hist[key] || [];
    const lastYear = Number((h.length ? h[h.length - 1]![0] : FROM).slice(0, 4));
    const rows: Row[] = [];
    let err = "";
    for (const p of paths) {
      for (let y = Math.min(lastYear, year); y <= year; y++) {
        try {
          const res = await fetch(`https://www.lottery.net/${p}/numbers/${y}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const got = parseLotteryNet(await res.text(), main, bonus);
          if (!got.length) err = "no draws on the page";
          rows.push(...got);
        } catch (e) { err = e instanceof Error ? e.message : "failed"; }
        await sleep(GAP_MS);
      }
    }
    added[key] = addRows(store, key, rows);
    if (err && !rows.length) failed[key] = err;
  }
  store.lastRun.finishedAt = new Date().toISOString();
  await save(store);
  return store;
}

/** Start an update (or join the one already running). */
export function updateLotto(): Promise<Store> {
  if (!running) running = pull().finally(() => { running = null; });
  return running;
}

/** What the server has: the newest draw per game and the last update's results. */
export async function lottoStatus() {
  const s = await load();
  const games = Object.fromEntries(Object.entries(s.hist).map(([k, rows]) => [k, { draws: rows.length, newest: rows.length ? rows[rows.length - 1]![0] : null }]));
  const kenoDays = Object.keys(s.keno).sort();
  return {
    updating: lottoUpdating(),
    gamesCovered: NY.length + Object.keys(LN).length,
    games,
    quickDrawThrough: kenoDays.length ? kenoDays[kenoDays.length - 1] : KENO_AFTER,
    lastRun: s.lastRun ?? null,
  };
}

/** For the app: every draw kept since the given date, and Quick Draw daily totals. */
export async function lottoSince(since: string) {
  const s = await load();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : FROM;
  const hist: Record<string, Row[]> = {};
  for (const [k, rows] of Object.entries(s.hist)) { const r = rows.filter((x) => x[0] >= d); if (r.length) hist[k] = r; }
  return { hist, keno: s.keno, updatedAt: s.lastRun?.finishedAt ?? null };
}

/** Twice a day, a few minutes after start-up. */
export function startLottoUpdates() {
  const tick = () => { void updateLotto().catch(() => undefined); };
  setTimeout(tick, 10 * 60_000).unref();
  setInterval(tick, 12 * 3_600_000).unref();
}
