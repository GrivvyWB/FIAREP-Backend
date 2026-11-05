#!/usr/bin/env node
// FIAREP — Lotto Generator feed, runs on the AWS server (always on).
// Pulls new draws (NY Open Data for Powerball, Mega Millions, Millionaire for Life, NY games and Quick Draw;
// lottery.net for the other states) and CT Keno (the CT Lottery's own results), and sends them to fiarep.com
// through this computer's FIAREP agent sign-in.
//   node lotto-feed.mjs keno   (every 2 minutes)   node lotto-feed.mjs full   (every 3 hours)
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const DIR = path.join(os.homedir(), ".fiarep-agent");
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));
const STATE = path.join(DIR, "lotto-feed.json");
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { last: {}, kenoDay: "2026-11-02" };
const FROM = "2026-10-25", GAP = 4000, UA = { "user-agent": "Mozilla/5.0 (compatible; FIAREP lotto feed)", accept: "text/html,application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const back7 = (d) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - 7); const s = x.toISOString().slice(0, 10); return s < FROM ? FROM : s; };
async function send(body) {
  const r = await fetch(`${cfg.apiBase}/v1/command/agent/lotto`, { method: "POST", headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", "user-agent": "fiarep-lotto-feed" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`fiarep.com said HTTP ${r.status}`);
  return r.json();
}
const LN = {
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
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function isoFrom(text) {
  const m = text.toLowerCase().match(/([a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return "";
  const mi = MONTHS.indexOf(m[1]);
  return mi < 0 ? "" : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
function parseLotteryNet(html, main, bonus) {
  const out = [];
  const body = html.slice(html.indexOf("<tbody"));
  for (const tr of body.split(/<tr[\s>]/).slice(1)) {
    const td = tr.match(/<td[^>]*class="colour[^"]*"[^>]*>([\s\S]*?)<\/td>/);
    const date = td ? isoFrom(td[1].replace(/<[^>]+>/g, " ")) : "";
    if (!date) continue;
    const uls = [...tr.matchAll(/<ul class="balls">([\s\S]*?)<\/ul>/g)].map((u) => [...u[1].matchAll(/<li class="([^"]*)">\s*(\d+)\s*<\/li>/g)].map((l) => ({ cls: l[1], n: Number(l[2]) })));
    const first = uls[0];
    if (!first || !first.length) continue;
    const isMain = (c) => /number-part-|(^|\s)ball$/.test(c.trim());
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

const nums = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
const digs = (s) => String(s ?? "").replace(/\D/g, "").split("").map(Number);
const NY = [
  { key: "pb", id: "d6yy-54nr", rows: (r) => { const a = nums(r.winning_numbers); return [[a.slice(0, 5), a.slice(5, 6)]]; } },
  { key: "mm", id: "5xaw-6ayf", rows: (r) => [[nums(r.winning_numbers), [Number(r.mega_ball)]]] },
  { key: "mfl", id: "a4w9-a3tp", rows: (r) => [[nums(r.winning_numbers).slice(0, 5), [Number(r.mill_ball)]]] },
  { key: "NY|NY Lotto", id: "6nbc-h7bj", rows: (r) => [[nums(r.winning_numbers).slice(0, 6), []]] },
  { key: "NY|Take 5", id: "dg63-4siq", rows: (r) => [r.midday_winning_numbers, r.evening_winning_numbers].filter(Boolean).map((x) => [nums(x), []]) },
  { key: "NY|Numbers", id: "hsys-3def", rows: (r) => [r.midday_daily, r.evening_daily].map(digs).filter((a) => a.length === 3).map((a) => [a, []]) },
  { key: "NY|Win 4", id: "hsys-3def", rows: (r) => [r.midday_win_4, r.evening_win_4].map(digs).filter((a) => a.length === 4).map((a) => [a, []]) },
];
const BASE = "https://data.ny.gov/resource/";
const lastOf = (rows) => rows.reduce((a, r) => (r[0] > a ? r[0] : a), "");

async function keno() {
  const today = nyToday();
  const r = await fetch(`https://ctlottery.com/api/winning-numbers?game=keno&date=${today}&limit=400`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`CT Lottery said HTTP ${r.status}`);
  const j = await r.json();
  const draws = (j.draws || []).filter((d) => Array.isArray(d.whiteBalls) && d.whiteBalls.length === 20)
    .map((d) => ({ id: String(d.drawId || ""), date: String(d.drawDate || today), numbers: d.whiteBalls.map(Number).sort((a, b) => a - b), multiplier: d.multiplier ?? null }))
    .sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 40);
  if (draws.length) await send({ ctKeno: draws });
  console.log(new Date().toISOString(), "CT Keno", draws.length, "draws sent");
}

async function full() {
  const today = nyToday(), year = Number(today.slice(0, 4)), report = { sent: {}, failed: {} };
  for (const f of NY) {
    const since = back7(state.last[f.key] || FROM);
    try {
      const r = await fetch(`${BASE}${f.id}.json?$where=${encodeURIComponent(`draw_date>='${since}T00:00:00'`)}&$order=draw_date&$limit=5000`, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const out = [];
      for (const x of await r.json()) { const d = String(x.draw_date || "").slice(0, 10); for (const [m, b] of f.rows(x)) if (m.length && m.every(Number.isFinite)) out.push([d, m, b]); }
      if (out.length) { await send({ hist: { [f.key]: out } }); state.last[f.key] = lastOf(out); report.sent[f.key] = out.length; }
    } catch (e) { report.failed[f.key] = e.message; }
  }
  try { // Quick Draw: whole days only
    const fresh = {};
    for (let off = 0; ; ) {
      const r = await fetch(`${BASE}7sqk-ycpk.json?$select=draw_date,winning_numbers&$where=${encodeURIComponent(`draw_date>'${state.kenoDay}T23:59:59' AND draw_date<'${today}T00:00:00'`)}&$order=draw_number&$limit=50000&$offset=${off}`, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json();
      for (const x of rows) { const d = String(x.draw_date || "").slice(0, 10), t = fresh[d] || (fresh[d] = new Array(81).fill(0)); t[0]++; for (const n of nums(x.winning_numbers)) if (n >= 1 && n <= 80) t[n]++; }
      off += rows.length; if (rows.length < 50000) break;
    }
    const days = Object.keys(fresh).sort();
    if (days.length) { await send({ keno: fresh }); state.kenoDay = days[days.length - 1]; report.sent["NY|Quick Draw days"] = days.length; }
  } catch (e) { report.failed["NY|Quick Draw"] = e.message; }
  for (const [key, [paths, main, bonus]] of Object.entries(LN)) {
    const since = back7(state.last[key] || FROM), rows = []; let err = "";
    for (const p of paths) for (let y = Math.min(Number(since.slice(0, 4)), year); y <= year; y++) {
      try {
        const r = await fetch(`https://www.lottery.net/${p}/numbers/${y}`, { headers: UA, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        rows.push(...parseLotteryNet(await r.text(), main, bonus).filter((x) => x[0] >= since));
      } catch (e) { err = e.message; }
      await sleep(GAP);
    }
    if (rows.length) { try { await send({ hist: { [key]: rows } }); state.last[key] = lastOf(rows); report.sent[key] = rows.length; } catch (e) { report.failed[key] = e.message; } }
    else if (err) report.failed[key] = err;
  }
  fs.writeFileSync(STATE, JSON.stringify(state));
  console.log(new Date().toISOString(), "full", JSON.stringify(report));
}

const mode = process.argv[2];
(mode === "keno" ? keno() : mode === "full" ? full() : Promise.reject(new Error("use: keno | full")))
  .catch((e) => { console.error(new Date().toISOString(), mode, "failed:", e.message); process.exit(1); });
