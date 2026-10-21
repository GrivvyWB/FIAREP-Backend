// Mold violation monitoring (CV-MOLD-001).
// Every apartment with an active mold violation — from HPD's open violations for
// the organization's buildings (§ 27-2017.3, "mold"), plus any staff add by hand —
// is a mold case. A case leaves the active list when staff mark it Mold Removed
// (after photo + the resident's sign-off), or when HPD closes the violation.
// Per building: original = every case found since tracking began; the percentage
// remaining is active ÷ original. At 60% or less an Inspection Recommended alert
// goes to management (once each time it gets there). Class B cases near or past
// their HPD certify-by date are flagged (risk of a Class C on reinspection).
// Dates come from HPD's record (originalcertifybydate / newcertifybydate).
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizationProperties, organizations, staffAccounts } from "@workspace/db";
import { notify } from "./audit";
import type { Actor } from "./auth";
import { geocodeNycAddress } from "./nycProperty";
import { logger } from "./logger";

export const PLATFORM = "default";
export const INSPECTION_THRESHOLD = 0.6;
const DEADLINE_SOON_DAYS = 14;
const HPD = process.env["FIAREP_HPD_VIOLATIONS_URL"] || "https://data.cityofnewyork.us/resource/wvxf-dwi5.json"; // override: tests

export type MoldCase = {
  id: string; tenantId: string; bbl: string; address: string; apartment: string; source: "hpd" | "manual";
  hpdViolationId: string | null; class: string; description: string; inspectionDate: string | null; correctBy: string | null; certifyBy: string | null;
  status: "active" | "removed"; removedAt: string | null; removedBy: string | null; removedHow: string | null; removal: Record<string, unknown> | null; createdAt: string;
};

let ready: Promise<unknown> | null = null;
export const ensureMoldTables = () => (ready ??= (async () => {
  await db.execute(sql`create table if not exists mold_cases (
    id text primary key, tenant_id text not null, bbl text not null, address text not null, apartment text not null,
    source text not null, hpd_violation_id text, class text not null default '', description text not null default '',
    inspection_date text, correct_by text, certify_by text, status text not null default 'active',
    removed_at timestamptz, removed_by text, removed_how text, removal jsonb, warned jsonb not null default '{}',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
  await db.execute(sql`create unique index if not exists mold_cases_hpd_uq on mold_cases (tenant_id, hpd_violation_id) where hpd_violation_id is not null`);
  await db.execute(sql`create index if not exists mold_cases_bbl_idx on mold_cases (bbl, apartment)`);
})().catch((e) => { ready = null; throw e; }));

type Row = Record<string, unknown>;
const rowsOf = (r: unknown) => (r as { rows: Row[] }).rows;
const str = (v: unknown) => (v == null ? "" : String(v));
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
/** "Apt 4-B", "#4b", "4B " → "4B". */
export const normApt = (v: unknown) => str(v).toUpperCase().replace(/\b(APT|APARTMENT|UNIT)\b\.?/g, "").replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");
const toCase = (r: Row): MoldCase => ({
  id: str(r["id"]), tenantId: str(r["tenant_id"]), bbl: str(r["bbl"]), address: str(r["address"]), apartment: str(r["apartment"]), source: str(r["source"]) as MoldCase["source"],
  hpdViolationId: (r["hpd_violation_id"] as string) ?? null, class: str(r["class"]), description: str(r["description"]), inspectionDate: day(r["inspection_date"]),
  correctBy: day(r["correct_by"]), certifyBy: day(r["certify_by"]), status: str(r["status"]) as MoldCase["status"], removedAt: iso(r["removed_at"]),
  removedBy: (r["removed_by"] as string) ?? null, removedHow: (r["removed_how"] as string) ?? null, removal: (r["removal"] as Row) ?? null, createdAt: iso(r["created_at"]) ?? "",
});

/** The organization's buildings: its watched buildings and its enrolled ones (FIAREP: every watched building). */
export async function moldBuildings(tenantId: string): Promise<Array<{ bbl: string; address: string; tenantId: string }>> {
  const out = new Map<string, { bbl: string; address: string; tenantId: string }>();
  const watch = await db.select({ state: entityRecords.state }).from(entityRecords).where(and(eq(entityRecords.entity, "watch-buildings"), eq(entityRecords.deleted, false)));
  for (const w of watch) {
    const org = str(w.state["organizationId"]) || PLATFORM;
    if (tenantId !== PLATFORM && org !== tenantId) continue;
    const bbl = str(w.state["bbl"]);
    if (/^\d{10}$/.test(bbl)) out.set(bbl, { bbl, address: [str(w.state["address"]), str(w.state["borough"])].filter(Boolean).join(", "), tenantId: org });
  }
  const props = await db.select({ org: organizationProperties.organizationId, address: organizationProperties.displayAddress, bbl: organizationProperties.bbl }).from(organizationProperties)
    .where(tenantId === PLATFORM ? eq(organizationProperties.active, true) : and(eq(organizationProperties.active, true), eq(organizationProperties.organizationId, tenantId)));
  for (const p of props) if (p.bbl && /^\d{10}$/.test(p.bbl) && !out.has(p.bbl)) out.set(p.bbl, { bbl: p.bbl, address: p.address, tenantId: p.org });
  return [...out.values()];
}

/** HPD's open mold violations for some buildings (by BBL), in groups so the query stays short. */
async function hpdOpenMold(bbls: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < bbls.length; i += 40) {
    const group = bbls.slice(i, i + 40).map((b) => `'${b}'`).join(",");
    const where = `bbl in (${group}) AND violationstatus='Open' AND upper(novdescription) like '%MOLD%'`;
    const url = `${HPD}?${new URLSearchParams({ $where: where, $limit: "5000", $select: "violationid,bbl,housenumber,streetname,apartment,class,novdescription,inspectiondate,originalcorrectbydate,newcorrectbydate,originalcertifybydate,newcertifybydate" })}`;
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HPD returned ${res.status}`);
    rows.push(...((await res.json()) as Row[]));
  }
  return rows;
}

/** Bring the list up to date with HPD: new open mold violations are added; ones HPD closed leave the active list. */
export async function syncMoldFromHpd(tenantId: string): Promise<{ buildings: number; added: number; closedByHpd: number }> {
  await ensureMoldTables();
  const buildings = await moldBuildings(tenantId);
  if (!buildings.length) return { buildings: 0, added: 0, closedByHpd: 0 };
  const byBbl = new Map(buildings.map((b) => [b.bbl, b]));
  const open = await hpdOpenMold([...byBbl.keys()]);
  let added = 0;
  const openIds = new Set<string>();
  for (const v of open) {
    const b = byBbl.get(str(v["bbl"])); if (!b) continue;
    const vid = str(v["violationid"]); openIds.add(vid);
    const certifyBy = day(v["newcertifybydate"]) ?? day(v["originalcertifybydate"]);
    const correctBy = day(v["newcorrectbydate"]) ?? day(v["originalcorrectbydate"]);
    const r = await db.execute(sql`insert into mold_cases (id, tenant_id, bbl, address, apartment, source, hpd_violation_id, class, description, inspection_date, correct_by, certify_by)
      values (${randomUUID()}, ${b.tenantId}, ${b.bbl}, ${b.address}, ${normApt(v["apartment"]) || "BLDG"}, 'hpd', ${vid}, ${str(v["class"])}, ${str(v["novdescription"]).slice(0, 600)}, ${day(v["inspectiondate"])}, ${correctBy}, ${certifyBy})
      on conflict (tenant_id, hpd_violation_id) where hpd_violation_id is not null do update set certify_by = excluded.certify_by, correct_by = excluded.correct_by, class = excluded.class, updated_at = now()
      returning (xmax = 0) as inserted`);
    if (rowsOf(r)[0]?.["inserted"]) added += 1;
  }
  // HPD closed it (certified / dismissed): no longer active.
  const scope = tenantId === PLATFORM ? sql`true` : sql`tenant_id = ${tenantId}`;
  const stillActive = rowsOf(await db.execute(sql`select id, bbl, hpd_violation_id from mold_cases where ${scope} and source = 'hpd' and status = 'active'`));
  let closedByHpd = 0;
  for (const c of stillActive) {
    // Only buildings just checked (a building taken off the list keeps its cases as they were).
    if (!byBbl.has(str(c["bbl"])) || openIds.has(str(c["hpd_violation_id"]))) continue;
    await db.execute(sql`update mold_cases set status = 'removed', removed_at = now(), removed_by = 'HPD', removed_how = 'Closed by HPD', updated_at = now() where id = ${str(c["id"])}`);
    closedByHpd += 1;
  }
  await afterChange(tenantId);
  return { buildings: buildings.length, added, closedByHpd };
}

/** Staff add a mold condition HPD doesn't have (yet). */
export async function addMoldCase(tenantId: string, input: { address: string; apartment: string; class?: string; description?: string; certifyBy?: string }) {
  await ensureMoldTables();
  const apartment = normApt(input.apartment);
  if (!input.address.trim() || !apartment) return { error: "Give the building address and the apartment." };
  const feature = await geocodeNycAddress(input.address).catch(() => null);
  const bbl = str(feature?.properties?.addendum?.pad?.["bbl"]);
  if (!/^\d{10}$/.test(bbl)) return { error: "That address could not be matched to an NYC building." };
  const label = str(feature?.properties?.["label"]).replace(/, USA$/, "") || input.address.trim();
  const id = randomUUID();
  await db.execute(sql`insert into mold_cases (id, tenant_id, bbl, address, apartment, source, class, description, certify_by)
    values (${id}, ${tenantId}, ${bbl}, ${label}, ${apartment}, 'manual', ${(input.class ?? "").toUpperCase().slice(0, 1)}, ${(input.description ?? "Mold condition").slice(0, 600)}, ${/^\d{4}-\d{2}-\d{2}$/.test(input.certifyBy ?? "") ? input.certifyBy! : null})`);
  await afterChange(tenantId);
  return { id, address: label, apartment };
}

/** Active mold cases in one apartment (a work order is being made or done there). */
export async function activeMoldAt(tenantId: string, address: string, apartment: string): Promise<MoldCase[]> {
  const apt = normApt(apartment);
  if (!address.trim() || !apt) return [];
  await ensureMoldTables();
  const feature = await geocodeNycAddress(address).catch(() => null);
  const bbl = str(feature?.properties?.addendum?.pad?.["bbl"]);
  if (!/^\d{10}$/.test(bbl)) return [];
  const scope = tenantId === PLATFORM ? sql`true` : sql`tenant_id = ${tenantId}`;
  return rowsOf(await db.execute(sql`select * from mold_cases where ${scope} and bbl = ${bbl} and apartment = ${apt} and status = 'active' order by class desc`)).map(toCase);
}

/** Staff: Mold Removed (after photo + the resident's sign-off). */
export async function markMoldRemoved(actor: Actor, caseId: string, removal: Record<string, unknown>) {
  await ensureMoldTables();
  const [c] = rowsOf(await db.execute(sql`select * from mold_cases where id = ${caseId} limit 1`)).map(toCase);
  if (!c || (actor.tenantId !== PLATFORM && c.tenantId !== actor.tenantId)) return { error: "No such mold case." };
  if (c.status !== "active") return { error: "Already marked removed." };
  await db.execute(sql`update mold_cases set status = 'removed', removed_at = now(), removed_by = ${actor.name}, removed_how = 'Mold Removed', removal = ${JSON.stringify(removal)}::jsonb, updated_at = now() where id = ${caseId}`);
  await afterChange(c.tenantId);
  return { removed: true, address: c.address, apartment: c.apartment, building: (await buildingSummaries(c.tenantId)).find((b) => b.bbl === c.bbl) ?? null };
}

export type BuildingSummary = {
  bbl: string; address: string; tenantId: string; original: number; active: number; removed: number;
  percentRemaining: number; percentCompleted: number; complianceScore: number; inspectionRecommended: boolean;
  awaiting: Array<Pick<MoldCase, "id" | "apartment" | "class" | "description" | "certifyBy" | "source">>;
  removedList: Array<Pick<MoldCase, "id" | "apartment" | "removedAt" | "removedBy" | "removedHow">>;
  deadlines: Array<{ id: string; apartment: string; class: string; certifyBy: string; daysLeft: number; overdue: boolean; escalationRisk: boolean }>;
};
const daysUntil = (d: string) => Math.ceil((Date.parse(`${d}T23:59:59-05:00`) - Date.now()) / 86_400_000);

/** Per building: the counts, percentages, inspection recommendation and deadlines. */
export async function buildingSummaries(tenantId: string): Promise<BuildingSummary[]> {
  await ensureMoldTables();
  const scope = tenantId === PLATFORM ? sql`true` : sql`tenant_id = ${tenantId}`;
  const cases = rowsOf(await db.execute(sql`select * from mold_cases where ${scope} order by address, apartment`)).map(toCase);
  const by = new Map<string, MoldCase[]>();
  for (const c of cases) by.set(c.bbl, [...(by.get(c.bbl) ?? []), c]);
  return [...by.entries()].map(([bbl, list]) => {
    const active = list.filter((c) => c.status === "active");
    const original = list.length;
    const remaining = original ? Math.round((active.length / original) * 1000) / 10 : 0;
    const deadlines = active.filter((c) => c.certifyBy).map((c) => {
      const d = daysUntil(c.certifyBy!);
      return { id: c.id, apartment: c.apartment, class: c.class, certifyBy: c.certifyBy!, daysLeft: d, overdue: d < 0, escalationRisk: c.class === "B" && d < 0 };
    }).filter((x) => x.daysLeft <= DEADLINE_SOON_DAYS).sort((a, b) => a.daysLeft - b.daysLeft);
    return {
      bbl, address: list[0]!.address, tenantId: list[0]!.tenantId, original, active: active.length, removed: original - active.length,
      percentRemaining: remaining, percentCompleted: original ? Math.round((100 - remaining) * 10) / 10 : 0, complianceScore: original ? Math.round((100 - remaining) * 10) / 10 : 100,
      inspectionRecommended: original > 0 && active.length / original <= INSPECTION_THRESHOLD,
      awaiting: active.map((c) => ({ id: c.id, apartment: c.apartment, class: c.class, description: c.description, certifyBy: c.certifyBy, source: c.source })),
      removedList: list.filter((c) => c.status === "removed").map((c) => ({ id: c.id, apartment: c.apartment, removedAt: c.removedAt, removedBy: c.removedBy, removedHow: c.removedHow })),
      deadlines,
    };
  }).sort((a, b) => b.active - a.active);
}

async function officeOf(tenantId: string) {
  const all = await db.select({ id: staffAccounts.id, role: staffAccounts.role }).from(staffAccounts).where(and(eq(staffAccounts.tenantId, tenantId), eq(staffAccounts.status, "approved")));
  return all.filter((m) => ["administrator", "management"].includes(String(m.role))).map((m) => m.id);
}
const moldActor = (tenantId: string): Actor => ({ id: "mold-monitor", tenantId, name: "Mold monitoring", role: "administrator", position: "", developments: [], sessionVersion: 0 });

/** After any change: Inspection Recommended (once each time a building gets to 60%), and deadline warnings (once per case per stage). */
async function afterChange(tenantId: string) {
  const tenants = tenantId === PLATFORM ? [PLATFORM, ...(await db.select({ id: organizations.id }).from(organizations)).map((o) => o.id)] : [tenantId];
  for (const t of [...new Set(tenants)]) {
    for (const b of (await buildingSummaries(t)).filter((x) => x.tenantId === t)) {
      const key = `mold-inspection:${t}:${b.bbl}`;
      const [flag] = rowsOf(await db.execute(sql`select value from settings where tenant_id = ${t} and key = ${key} limit 1`));
      const alerted = (flag?.["value"] as { at?: string } | undefined)?.at;
      if (b.inspectionRecommended && !alerted) {
        for (const id of await officeOf(t)) await notify(moldActor(t), id, `Inspection Recommended — ${b.address}`,
          `Original mold violations: ${b.original} · Resolved: ${b.removed} · Active remaining: ${b.active} · Mold exposure level: ${b.percentRemaining}%. Mold conditions have been reduced to the target threshold and may be ready for verification — schedule an inspection.`).catch(() => undefined);
        await db.execute(sql`insert into settings (tenant_id, key, value, created_at, updated_at) values (${t}, ${key}, ${JSON.stringify({ at: new Date().toISOString(), active: b.active, original: b.original })}::jsonb, now(), now())
          on conflict (tenant_id, key) do update set value = excluded.value, updated_at = now()`);
      } else if (!b.inspectionRecommended && alerted) {
        await db.execute(sql`delete from settings where tenant_id = ${t} and key = ${key}`); // above 60% again: alert again next time it gets there
      }
      for (const d of b.deadlines) {
        const stage = d.overdue ? "overdue" : "soon";
        const done = rowsOf(await db.execute(sql`select warned from mold_cases where id = ${d.id}`))[0]?.["warned"] as Record<string, boolean> | undefined;
        if (done?.[stage]) continue;
        const msg = d.overdue
          ? `${d.class === "B" ? "Class B mold past its certification date — risk of Class C on reinspection" : "Mold violation past its certification date"}: ${b.address} apt ${d.apartment}`
          : `Mold violation due for certification in ${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"}: ${b.address} apt ${d.apartment}`;
        for (const id of await officeOf(t)) await notify(moldActor(t), id, msg, `HPD certify-by date ${d.certifyBy}${d.class ? ` · Class ${d.class}` : ""}`).catch(() => undefined);
        await db.execute(sql`update mold_cases set warned = warned || ${JSON.stringify({ [stage]: true })}::jsonb where id = ${d.id}`);
      }
    }
  }
}

/** Twice a day (when automatic City checks are on): every organization's buildings against HPD, and the deadline warnings. */
export async function moldSweep(): Promise<void> {
  try { await syncMoldFromHpd(PLATFORM); } catch (err) { logger.warn({ err }, "Mold sweep failed"); }
}
