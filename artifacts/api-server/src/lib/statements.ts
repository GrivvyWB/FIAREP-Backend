// 30-day accounting. Every purchase FIAREP makes on a client's quote is a
// receipt; the client gets each one in the app the moment it is purchased.
// Thirty days after a client's first receipt of the period, the system cuts
// that client's bill by itself: every receipt of the period, building by
// building, plus anything from earlier bills still not paid back, and the
// total owed. It goes to the client's administrators and management in the
// app and to the company's email. Then the next period starts with the next
// receipt. Nobody presses anything for the bill.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, entityRecords, notifications, organizations, staffAccounts } from "@workspace/db";
import { deliverPushNotification } from "./push";
import { FIAREP_TENANT } from "./fiarepDispatch";
import { quotesOf, withQuotes, type QuickQuote } from "../routes/quickQuote";

const DAY = 24 * 60 * 60 * 1000;
const PERIOD_MS = 30 * DAY;
const ENTITY = "billing-statements";
const money = (n: number) => `$${n.toFixed(2)}`;
const round = (n: number) => Math.round(n * 100) / 100;

export type StatementItem = {
  projectId: string; quoteId: string; building: string; purchasedAt: string;
  lines: Array<{ qty: number; label: string; amount: number }>;
  total: number; paid: boolean; carried: boolean;
};
export type Statement = {
  id: string; clientTenantId: string; clientCompany: string;
  periodStart: string; periodEnd: string; createdAt: string;
  buildings: Array<{ building: string; items: StatementItem[]; spent: number; owed: number }>;
  spent: number; paidBack: number; carried: number; owed: number;
};

type Receipt = { projectId: string; quote: QuickQuote };

async function receipts(): Promise<Receipt[]> {
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, "projects"), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(5000);
  return rows.flatMap((r) => quotesOf(r.state)
    .filter((q) => !!q.purchasedAt && !!q.clientTenantId && q.clientTenantId !== FIAREP_TENANT)
    .map((quote) => ({ projectId: r.id, quote })));
}

const item = (r: Receipt, carried: boolean): StatementItem => ({
  projectId: r.projectId, quoteId: r.quote.id || "", building: r.quote.building || "Building",
  purchasedAt: r.quote.purchasedAt || "",
  lines: r.quote.lines.map((l) => ({ qty: l.qty, label: l.label, amount: l.amount })),
  total: r.quote.total, paid: !!r.quote.paidAt, carried,
});

function build(clientTenantId: string, clientCompany: string, start: Date, end: Date, items: StatementItem[]): Statement {
  const byBuilding = new Map<string, StatementItem[]>();
  for (const i of items) byBuilding.set(i.building, [...(byBuilding.get(i.building) ?? []), i]);
  const buildings = [...byBuilding.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([building, list]) => ({
    building,
    items: list.sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt)),
    spent: round(list.filter((i) => !i.carried).reduce((n, i) => n + i.total, 0)),
    owed: round(list.filter((i) => !i.paid).reduce((n, i) => n + i.total, 0)),
  }));
  const fresh = items.filter((i) => !i.carried);
  return {
    id: `stmt-${clientTenantId}-${start.toISOString().slice(0, 10)}`,
    clientTenantId, clientCompany,
    periodStart: start.toISOString(), periodEnd: end.toISOString(), createdAt: new Date().toISOString(),
    buildings,
    spent: round(fresh.reduce((n, i) => n + i.total, 0)),
    paidBack: round(fresh.filter((i) => i.paid).reduce((n, i) => n + i.total, 0)),
    carried: round(items.filter((i) => i.carried && !i.paid).reduce((n, i) => n + i.total, 0)),
    owed: round(items.filter((i) => !i.paid).reduce((n, i) => n + i.total, 0)),
  };
}

/** The bill as text, building by building. */
function billText(s: Statement): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const parts = [`${s.clientCompany} — bill for ${day(s.periodStart)} to ${day(s.periodEnd)}`];
  for (const b of s.buildings) {
    parts.push([
      b.building,
      ...b.items.map((i) => `${day(i.purchasedAt)}${i.carried ? " (from an earlier bill)" : ""} — ${i.lines.map((l) => `${l.qty} × ${l.label}`).join(", ")} — ${money(i.total)}${i.paid ? " — paid" : ""}`),
      `Building owed: ${money(b.owed)}`,
    ].join("\n"));
  }
  parts.push([
    `Spent this period: ${money(s.spent)}`, `Paid back: ${money(s.paidBack)}`,
    ...(s.carried ? [`Still owed from earlier bills: ${money(s.carried)}`] : []),
    `Total owed: ${money(s.owed)}`,
  ].join("\n"));
  parts.push("Every receipt is in your FIAREP app.", "FIAREP");
  return parts.join("\n\n");
}

async function send(s: Statement): Promise<void> {
  const people = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, s.clientTenantId), eq(staffAccounts.status, "approved"),
    inArray(staffAccounts.role, ["administrator", "management"]),
  ));
  const detail = s.buildings.map((b) => `${b.building}: ${money(b.owed)}`).join(" · ").slice(0, 400);
  if (people.length) {
    const rows = await db.insert(notifications).values(people.map((p) => ({
      id: randomUUID(), tenantId: s.clientTenantId, target: p.id,
      message: `FIAREP monthly bill — ${money(s.owed)} owed`, detail, reportId: `bill:${s.id}`,
    }))).returning();
    for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
  }
  const admins = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"), eq(staffAccounts.role, "administrator"),
  ));
  if (admins.length) {
    const rows = await db.insert(notifications).values(admins.map((a) => ({
      id: randomUUID(), tenantId: FIAREP_TENANT, target: a.id,
      message: `Monthly bill sent to ${s.clientCompany} — ${money(s.owed)} owed`, detail, reportId: `bill:${s.id}`,
    }))).returning();
    for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
  }
  const [org] = await db.select({ name: organizations.name, features: organizations.features }).from(organizations).where(eq(organizations.id, s.clientTenantId)).limit(1);
  const email = String(((org?.features ?? {}) as Record<string, unknown>)["contactEmail"] ?? "").trim();
  if (org && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const { sendEmail } = await import("./command/mail");
    await sendEmail(FIAREP_TENANT, {
      to: [{ name: org.name, email, from: "" }], cc: [], attachments: [],
      subject: `FIAREP monthly bill — ${money(s.owed)} owed`, body: billText(s),
    }, "Monthly bill").catch(() => undefined);
  }
}

/** Put the bill's id on the receipts it first went out on. */
async function stamp(statementId: string, picked: Receipt[]): Promise<void> {
  const byProject = new Map<string, Set<string>>();
  for (const r of picked) byProject.set(r.projectId, (byProject.get(r.projectId) ?? new Set()).add(r.quote.id || ""));
  for (const [projectId, ids] of byProject) {
    const [project] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, projectId), eq(entityRecords.tenantId, FIAREP_TENANT))).limit(1);
    if (!project) continue;
    const list = quotesOf(project.state).map((q) => (ids.has(q.id || "") && !q.statementId ? { ...q, statementId } : q));
    await db.update(entityRecords)
      .set({ state: withQuotes(project.state, list), version: (project.version ?? 1) + 1, updatedAt: new Date() })
      .where(and(eq(entityRecords.id, projectId), eq(entityRecords.tenantId, FIAREP_TENANT)));
  }
}

/** Cut every bill that is due. */
export async function runStatements(now = new Date()): Promise<number> {
  const all = await receipts();
  const clients = new Map<string, Receipt[]>();
  for (const r of all) clients.set(r.quote.clientTenantId, [...(clients.get(r.quote.clientTenantId) ?? []), r]);
  let cut = 0;
  for (const [clientTenantId, list] of clients) {
    let unbilled = list.filter((r) => !r.quote.statementId).sort((a, b) => String(a.quote.purchasedAt).localeCompare(String(b.quote.purchasedAt)));
    while (unbilled.length) {
      const start = new Date(unbilled[0].quote.purchasedAt!);
      const end = new Date(start.getTime() + PERIOD_MS);
      if (end > now) break;
      const period = unbilled.filter((r) => new Date(r.quote.purchasedAt!) < end);
      const carried = list.filter((r) => r.quote.statementId && !r.quote.paidAt);
      const company = period[period.length - 1].quote.clientCompany || clientTenantId;
      const s = build(clientTenantId, company, start, end, [...period.map((r) => item(r, false)), ...carried.map((r) => item(r, true))]);
      const inserted = await db.insert(entityRecords).values({
        id: s.id, tenantId: FIAREP_TENANT, entity: ENTITY, version: 1, state: s as unknown as Record<string, unknown>,
        createdBy: "system", createdAt: now, updatedAt: now,
      }).onConflictDoNothing().returning({ id: entityRecords.id });
      await stamp(s.id, period);
      if (inserted.length) { await send(s); cut += 1; }
      for (const r of period) r.quote.statementId = s.id;
      unbilled = unbilled.filter((r) => !period.includes(r));
    }
  }
  return cut;
}

export async function listStatements(clientTenantId?: string): Promise<Statement[]> {
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(2000);
  return rows.map((r) => r.state as unknown as Statement)
    .filter((s) => !clientTenantId || s.clientTenantId === clientTenantId)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

/** What each client owes right now, and when its current period closes. */
export async function openBalances(clientTenantId?: string): Promise<Array<{
  clientTenantId: string; clientCompany: string; owed: number; receipts: number; billDue: string | null;
}>> {
  const all = (await receipts()).filter((r) => !clientTenantId || r.quote.clientTenantId === clientTenantId);
  const out = new Map<string, { clientTenantId: string; clientCompany: string; owed: number; receipts: number; billDue: string | null }>();
  for (const r of all) {
    const c = out.get(r.quote.clientTenantId) ?? { clientTenantId: r.quote.clientTenantId, clientCompany: r.quote.clientCompany, owed: 0, receipts: 0, billDue: null };
    if (!r.quote.paidAt) { c.owed = round(c.owed + r.quote.total); c.receipts += 1; }
    if (!r.quote.statementId) {
      const due = new Date(new Date(r.quote.purchasedAt!).getTime() + PERIOD_MS).toISOString();
      if (!c.billDue || due < c.billDue) c.billDue = due;
    }
    out.set(r.quote.clientTenantId, c);
  }
  return [...out.values()].sort((a, b) => a.clientCompany.localeCompare(b.clientCompany));
}

export function startStatements(): void {
  setTimeout(() => { void runStatements().catch((e) => console.error("Monthly bills:", e)); }, 120_000).unref?.();
  setInterval(() => { void runStatements().catch((e) => console.error("Monthly bills:", e)); }, 60 * 60 * 1000).unref?.();
}
