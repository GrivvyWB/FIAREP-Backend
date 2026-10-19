// Scopes of work, contractors and reports from the Command Center.
//  - write_scope_of_work: the Command Center writes the scope (work, line items
//    for contractors to price, walk-through, bid close) and saves it in
//    Procurement, ready to send. It comes from a work order, a resident
//    complaint, or an address + description.
//  - send_scope_to_contractors: releases it for bidding exactly like
//    Procurement's "Release to vendors" — a new SR- vendor code, then the same
//    email (FIAREP's Outlook) to every vendor contact, or only the ones named.
//    A scope already out for bid is sent again to the ones named (or everyone on the list).
//  - write_report: saves a written report the Command Center put together;
//    it's listed on the Command Center page to open / print.
import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entityRecords, publicAccessCodes, staffAccounts } from "@workspace/db";
import { emailReleasedScope } from "../vendorEmail";
import { generatedCode } from "../domain";
import { notify } from "../audit";
import type { Actor } from "../auth";
import { commandWorkOrders } from "./tables";
import { commandAuditLog } from "./audit";

const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const actorFor = (tenantId: string, id: string, name: string): Actor => ({ id, tenantId, name, role: "administrator", position: "", developments: [], sessionVersion: 0 });

export type Contractor = { name: string; email: string; company: string; trade: string };

/** The vendor email list (Procurement → Vendor Contacts). */
export async function listContractors(tenantId: string, trade = ""): Promise<Contractor[]> {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, tenantId), eq(entityRecords.entity, "vendor-contacts"), eq(entityRecords.deleted, false)));
  const t = norm(trade).replace(/(ers?|ing|s)$/, "");
  return rows.map((r) => ({ name: s(r.state["name"], 120), email: s(r.state["email"], 200), company: s(r.state["company"] ?? r.state["companyName"], 120), trade: s(r.state["trade"] ?? r.state["category"] ?? r.state["specialty"], 80) }))
    .filter((c) => c.email.includes("@"))
    .filter((c) => !t || `${c.trade} ${c.company} ${c.name}`.toLowerCase().includes(t));
}

type Line = { title: string; location: string; description: string };
export type ScopeInput = {
  tenantId: string; byId: string; byName: string; runId?: string;
  workOrderId?: string; complaintNo?: string; address?: string;
  title?: string; scope: string; lines?: Line[];
  walkthroughAt?: string; walkthroughNote?: string; bidCloseAt?: string;
};

/** Save a Command Center scope in Procurement, ready to send to contractors. */
export async function createScope(input: ScopeInput): Promise<{ scope: ReturnType<typeof scopeView> } | { error: string }> {
  let tenantId = input.tenantId;
  let address = s(input.address, 300);
  const extra: Record<string, unknown> = {};
  let development: string | null = null;
  if (input.workOrderId) {
    const [w] = await db.select().from(commandWorkOrders).where(eq(commandWorkOrders.id, input.workOrderId)).limit(1);
    if (!w || (tenantId !== "default" && w.tenantId !== tenantId)) return { error: "No work order with that id." };
    tenantId = w.tenantId; address ||= w.address;
    extra["commandWorkOrderId"] = w.id; extra["sourceRef"] = w.alertKey || w.title.slice(0, 60);
    if (w.alertId.startsWith("resident:")) { extra["sourceEntity"] = "resident-reports"; extra["sourceRecordId"] = w.alertId.slice(9); extra["complaintNo"] = w.alertKey; }
  }
  if (input.complaintNo) {
    const no = s(input.complaintNo, 20).toUpperCase();
    const [r] = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'complaintNo' = ${no}`, tenantId === "default" ? sql`true` : eq(entityRecords.tenantId, tenantId))).limit(1);
    if (!r) return { error: `No complaint ${no}.` };
    tenantId = r.tenantId; development = r.development;
    address ||= [s(r.state["address"], 200), s(r.state["unit"], 20) ? `Unit ${s(r.state["unit"], 20)}` : ""].filter(Boolean).join(" ");
    Object.assign(extra, { sourceEntity: "resident-reports", sourceRecordId: r.id, complaintNo: no, sourceRef: no });
  }
  if (!address) return { error: "Give the address (or a work order / complaint number)." };
  const scope = s(input.scope, 8000);
  if (!scope) return { error: "The scope of work is empty." };
  const lines = (input.lines ?? []).map((l) => ({ title: s(l.title, 120), location: s(l.location, 120), description: s(l.description, 600), cost: "" })).filter((l) => l.title || l.description).slice(0, 40);
  const id = randomUUID();
  const now = new Date();
  const state: Record<string, unknown> = {
    ...extra,
    trackingId: generatedCode("procurement"), status: "approved",
    address, scope,
    title: [extra["sourceRef"], address].filter(Boolean).join(" · ") || s(input.title, 200) || address,
    ...(lines.length ? { cpmEstimate: { header: {}, categories: lines, totals: {} } } : {}),
    ...(s(input.walkthroughAt, 40) ? { walkthroughAt: s(input.walkthroughAt, 40) } : {}),
    ...(s(input.walkthroughNote, 300) ? { walkthroughNote: s(input.walkthroughNote, 300) } : {}),
    ...(s(input.bidCloseAt, 40) ? { bidCloseAt: s(input.bidCloseAt, 40) } : {}),
    cpmName: "Command Center", cpmId: input.byId, writtenBy: "Command Center", requestedBy: input.byName,
    approvedBy: `Command Center (for ${input.byName})`, approvedAt: now.toISOString(), createdAt: now.toISOString(),
  };
  await db.insert(entityRecords).values({ id, tenantId, entity: "procurement", development, state, createdBy: input.byId, createdAt: now, updatedAt: now });
  await commandAuditLog({ tenantId, actor: input.byName, runId: input.runId, event: "scope.written", detail: { scope: id, address, source: extra["sourceRef"] ?? null } });
  const [row] = await db.select().from(entityRecords).where(eq(entityRecords.id, id)).limit(1);
  return { scope: scopeView(row!) };
}

export function scopeView(r: typeof entityRecords.$inferSelect) {
  const st = r.state;
  const email = st["vendorEmail"] as { sent?: number; failed?: number; recipients?: number; at?: string } | undefined;
  return {
    id: r.id, code: s(st["trackingId"], 20), status: s(st["status"], 30), address: s(st["address"], 300), title: s(st["title"], 200),
    source: s(st["sourceRef"], 60) || null, writtenBy: s(st["writtenBy"], 60) || s(st["cpmName"], 120),
    scope: s(st["scope"], 1200), bidCloseAt: s(st["bidCloseAt"], 40) || null, walkthroughAt: s(st["walkthroughAt"], 40) || null,
    emailed: email ? { sent: email.sent ?? 0, failed: email.failed ?? 0, at: email.at ?? null } : null,
    vendor: s(st["vendor"], 120) || null, updatedAt: r.updatedAt,
  };
}

export async function findScope(tenantId: string, ref: string) {
  const key = s(ref, 60);
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, "procurement"), eq(entityRecords.deleted, false),
    tenantId === "default" ? sql`true` : eq(entityRecords.tenantId, tenantId),
    sql`(${entityRecords.id} = ${key} or upper(${entityRecords.state}->>'trackingId') = ${key.toUpperCase()} or upper(${entityRecords.state}->>'draftCode') = ${key.toUpperCase()} or upper(${entityRecords.state}->>'sourceRef') = ${key.toUpperCase()})`))
    .orderBy(desc(entityRecords.updatedAt)).limit(1);
  return rows[0] ?? null;
}

export async function listScopes(tenantId: string, status = "", limit = 20) {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, "procurement"), eq(entityRecords.deleted, false),
    tenantId === "default" ? sql`true` : eq(entityRecords.tenantId, tenantId),
    status ? sql`lower(${entityRecords.state}->>'status') = ${norm(status)}` : sql`true`))
    .orderBy(desc(entityRecords.updatedAt)).limit(limit);
  return rows.map(scopeView);
}

/** Release a scope for bidding (or send one already out for bid again) to contractors. */
export async function sendScope(tenantId: string, ref: string, only: string[], by: { id: string; name: string; runId?: string }) {
  const row = await findScope(tenantId, ref);
  if (!row) return { error: `No scope ${ref}.` };
  const status = norm(row.state["status"]);
  if (!["approved", "bidding"].includes(status)) return { error: `Scope ${s(row.state["trackingId"], 20)} is ${status || "not ready"}; only a scope ready to send or out for bid can go to contractors.` };
  // Named contractors: from the vendor list by name / company / email, or typed email addresses.
  const list = await listContractors(row.tenantId);
  const picked: Array<{ name: string; email: string }> = [];
  const notFound: string[] = [];
  for (const want of only.map((x) => s(x, 200)).filter(Boolean)) {
    const w = want.toLowerCase();
    const hits = w.includes("@") ? [list.find((c) => c.email.toLowerCase() === w) ?? { name: "", email: want }]
      : list.filter((c) => c.name.toLowerCase().includes(w) || c.company.toLowerCase().includes(w));
    if (hits.length) for (const h of hits) picked.push({ name: h.name, email: h.email }); else notFound.push(want);
  }
  if (only.length && !picked.length) return { error: `None of these are on the vendor list: ${notFound.join(", ")}. Add them in Procurement → Vendor Contacts, or give their email.` };
  if (!only.length && !list.length) return { error: "The vendor list is empty. Add contractors in Procurement → Vendor Contacts, or name an email." };
  let current = row;
  const now = new Date();
  if (status === "approved") {
    // Same as Procurement's release: a fresh SR- vendor code, registered so vendors can open the scope.
    let done = false;
    for (let attempt = 0; attempt < 8 && !done; attempt++) {
      const code = `SR-${randomBytes(4).readUInt32BE(0) % 90000 + 10000}`;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(publicAccessCodes).values({ id: randomUUID(), kind: "vendor", code, tenantId: row.tenantId, recordId: row.id });
          const next = { ...row.state, draftCode: row.state["draftCode"] ?? row.state["trackingId"], trackingId: code, status: "bidding", broadcastAt: now.toISOString(), broadcastBy: `Command Center (for ${by.name})` };
          const [u] = await tx.update(entityRecords).set({ state: next, version: sql`${entityRecords.version} + 1`, updatedAt: now })
            .where(and(eq(entityRecords.id, row.id), eq(entityRecords.version, row.version))).returning();
          if (!u) throw Object.assign(new Error("changed"), { code: "changed" });
          current = u;
        });
        done = true;
      } catch (e) {
        if ((e as { code?: string }).code === "changed") return { error: "Someone changed this scope just now. Try again." };
        if ((e as { code?: string }).code !== "23505") throw e;
      }
    }
    if (!done) return { error: "Couldn't make a vendor code. Try again." };
  }
  let delivery: { sent: number; failed: number; recipients: number; error?: string } = { sent: 0, failed: 0, recipients: 0 };
  try { delivery = await emailReleasedScope(current.tenantId, current.state, picked, !only.length); }
  catch { delivery = { ...delivery, error: "Email service unavailable" }; }
  const report = { ...delivery, action: status === "approved" ? "broadcast" : "resend", at: new Date().toISOString(), by: `Command Center (for ${by.name})` };
  await db.update(entityRecords).set({ state: sql`${entityRecords.state} || ${JSON.stringify({ vendorEmail: report })}::jsonb` }).where(eq(entityRecords.id, current.id));
  await commandAuditLog({ tenantId: current.tenantId, actor: by.name, runId: by.runId, event: "scope.sent", detail: { scope: current.id, code: current.state["trackingId"], ...delivery, only: only.length ? picked.map((p) => p.email) : "all vendor contacts" } });
  // Procurement hears about it.
  const proc = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(eq(staffAccounts.tenantId, current.tenantId), eq(staffAccounts.status, "approved"), eq(staffAccounts.role, "procurement")));
  for (const p of proc) await notify(actorFor(current.tenantId, by.id, by.name), p.id, `Scope sent to contractors: ${s(current.state["trackingId"], 20)}`, `${s(current.state["address"], 200)} · ${delivery.sent} emailed (Command Center)`, current.id).catch(() => undefined);
  return { code: s(current.state["trackingId"], 20), address: s(current.state["address"], 300), status: "bidding", emailed: delivery.sent, failed: delivery.failed, ...(delivery.error ? { emailError: delivery.error } : {}), ...(notFound.length ? { notOnList: notFound } : {}) };
}

export async function saveReport(tenantId: string, title: string, body: string, by: string, runId?: string) {
  const id = randomUUID();
  await db.execute(sql`insert into command_reports (id, tenant_id, title, body, created_by, run_id) values (${id}, ${tenantId}, ${s(title, 200) || "Report"}, ${s(body, 60000)}, ${by}, ${runId ?? null})`);
  await commandAuditLog({ tenantId, actor: by, runId, event: "report.written", detail: { report: id, title: s(title, 200) } });
  return { id, title: s(title, 200) || "Report" };
}

export async function listReports(tenantId: string, limit = 30) {
  const r = await db.execute(sql`select id, title, created_by as "createdBy", created_at as "createdAt", length(body) as size from command_reports where tenant_id = ${tenantId} order by created_at desc limit ${limit}`);
  return r.rows as Array<{ id: string; title: string; createdBy: string; createdAt: string; size: number }>;
}

export async function getReport(tenantId: string, id: string) {
  const r = await db.execute(sql`select id, title, body, created_by as "createdBy", created_at as "createdAt" from command_reports where id = ${id} and (tenant_id = ${tenantId} or ${tenantId} = 'default') limit 1`);
  return (r.rows[0] ?? null) as { id: string; title: string; body: string; createdBy: string; createdAt: string } | null;
}
