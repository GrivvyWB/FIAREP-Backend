// What must be bought before the work starts. A FIAREP technician standing in
// the apartment lists what the job needs — a window, a leak, a trap under the
// sink — photographs each one, and the server prices it from the repair price
// book. The list goes to the CLIENT, never to the resident, and the technician
// cannot start until the client approves it.
//
// The resident's own status page returns an allow-list of fields and never the
// whole record, so nothing here reaches them — provided quote events are not
// written into state.updates, which that page does return.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, entityRecords, notifications, organizations, staffAccounts } from "@workspace/db";
import type { Actor } from "./auth";
import { audit } from "./audit";
import { deliverPushNotification } from "./push";
import { catalogPrice } from "./repairCatalog";
import { FIAREP_TENANT } from "./fiarepDispatch";

type Row = typeof entityRecords.$inferSelect;

export type QuoteLine = {
  id: string;
  key: string;        // price-book key
  label: string;      // as the book names it, kept with the line
  unit: string;
  qty: number;
  unitPrice: number;  // priced by the server, never by the phone
  amount: number;
  note: string;
  photo: string;      // object path of the photo taken on site
};

export type Quote = {
  lines: QuoteLine[];
  total: number;
  /** admin_review: a technician priced it and FIAREP's administrator has not
   *  yet sent it on. Only an administrator sends a quote to the client. */
  status: "admin_review" | "pending" | "approved" | "declined";
  sentAt: string;
  sentBy: string;
  sentById?: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;      // why it was declined
};

export function quoteOf(state: Record<string, unknown>): Quote | null {
  const q = state["quote"];
  return q && typeof q === "object" && !Array.isArray(q) ? (q as Quote) : null;
}

/** A quote waiting on the administrator or the client holds the work. */
export function quoteBlocksStart(state: Record<string, unknown>): boolean {
  const status = quoteOf(state)?.status;
  return status === "pending" || status === "admin_review";
}

/** FIAREP's administrators: everyone a technician's quote goes to first. */
async function fiarepAdministrators(): Promise<string[]> {
  const rows = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"),
    eq(staffAccounts.role, "administrator"),
  ));
  return rows.map((r) => r.id);
}

async function overrides(): Promise<Record<string, number>> {
  const [row] = await db.select().from(entityRecords)
    .where(and(eq(entityRecords.entity, "pricing-overrides"), eq(entityRecords.id, "pricing-overrides")))
    .limit(1);
  const items = (row?.state as Record<string, unknown> | undefined)?.["items"];
  return items && typeof items === "object" && !Array.isArray(items) ? (items as Record<string, number>) : {};
}

async function alert(tenantId: string, targets: string[], message: string, detail: string, reportId: string): Promise<void> {
  const ids = [...new Set(targets.filter(Boolean))];
  if (!ids.length) return;
  const rows = await db.insert(notifications).values(
    ids.map((target) => ({ id: randomUUID(), tenantId, target, message, detail, reportId })),
  ).returning();
  for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
}

/** Price what the technician listed and send it to the client for approval.
 *  Runs on FIAREP's copy of the complaint; the client sees it on theirs. */
export async function sendQuote(
  actor: Actor,
  copy: Row,
  input: Array<{ key?: unknown; qty?: unknown; note?: unknown; photo?: unknown }>,
): Promise<{ ok: true; quote: Quote } | { ok: false; status: number; error: string }> {
  if (actor.tenantId !== FIAREP_TENANT) return { ok: false, status: 403, error: "Only FIAREP's crew price a job." };
  const client = copy.state["fiarepClient"] as { tenantId?: string; recordId?: string; company?: string } | undefined;
  if (!client?.tenantId || !client.recordId) return { ok: false, status: 400, error: "This complaint did not come from a client company." };
  if (quoteOf(copy.state)?.status === "approved") return { ok: false, status: 409, error: "The client already approved this one." };
  if (!Array.isArray(input) || input.length === 0) return { ok: false, status: 400, error: "Add at least one item." };

  const book = await overrides();
  const lines: QuoteLine[] = [];
  for (const raw of input.slice(0, 50)) {
    const key = String(raw?.key ?? "").trim();
    const found = catalogPrice(key, book);
    if (!found) return { ok: false, status: 400, error: `"${key}" is not in the price book.` };
    const qty = Number(raw?.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, status: 400, error: `Enter how many for ${found.label}.` };
    const rounded = Math.round(qty * 100) / 100;
    lines.push({
      id: randomUUID(),
      key, label: found.label, unit: found.unit,
      qty: rounded,
      unitPrice: found.price,
      amount: Math.round(found.price * rounded * 100) / 100,
      note: String(raw?.note ?? "").trim().slice(0, 300),
      photo: String(raw?.photo ?? "").trim().slice(0, 300),
    });
  }
  const total = Math.round(lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
  const now = new Date();
  const quote: Quote = { lines, total, status: "pending", sentAt: now.toISOString(), sentBy: actor.name, sentById: actor.id };

  // A technician has no approval rights: the quote goes to FIAREP's
  // administrator, who sends it to the client or turns it back.
  if (actor.role !== "administrator") {
    const held: Quote = { ...quote, status: "admin_review" };
    await db.update(entityRecords).set({ state: { ...copy.state, quote: held }, version: (copy.version ?? 1) + 1, updatedAt: now })
      .where(and(eq(entityRecords.id, copy.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
    await audit(actor, "resident-reports.quote-to-admin", `${lines.length} item(s), $${total.toFixed(2)}`, copy.id);
    const ref = [String(copy.state["complaintNo"] || ""), String(copy.state["address"] || "")].filter(Boolean).join(" · ");
    await alert(FIAREP_TENANT, await fiarepAdministrators(), `Quote to approve — $${total.toFixed(2)} from ${actor.name}`, ref, copy.id);
    return { ok: true, quote: held };
  }
  return deliverToClient(actor, copy, quote);
}

/** Put the quote in front of the client's management. Administrator only. */
async function deliverToClient(
  actor: Actor,
  copy: Row,
  quote: Quote,
): Promise<{ ok: true; quote: Quote } | { ok: false; status: number; error: string }> {
  const client = copy.state["fiarepClient"] as { tenantId?: string; recordId?: string; company?: string } | undefined;
  if (!client?.tenantId || !client.recordId) return { ok: false, status: 400, error: "This complaint did not come from a client company." };
  const { lines, total } = quote;
  const now = new Date();
  const [source] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, client.recordId), eq(entityRecords.tenantId, client.tenantId), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!source) return { ok: false, status: 404, error: "The client's copy of this complaint is gone." };

  await db.transaction(async (tx) => {
    await tx.update(entityRecords).set({ state: { ...copy.state, quote }, version: (copy.version ?? 1) + 1, updatedAt: now })
      .where(and(eq(entityRecords.id, copy.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
    await tx.update(entityRecords).set({ state: { ...source.state, quote }, version: (source.version ?? 1) + 1, updatedAt: now })
      .where(and(eq(entityRecords.id, source.id), eq(entityRecords.tenantId, source.tenantId)));
  });
  await audit(actor, "resident-reports.quote-sent", `${lines.length} item(s), $${total.toFixed(2)}`, copy.id);

  // The client's management decide. The resident is told nothing: the money is
  // between FIAREP and the company.
  const managers = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, client.tenantId), eq(staffAccounts.status, "approved"),
    inArray(staffAccounts.role, ["administrator", "management"]),
  ));
  const ref = [String(source.state["complaintNo"] || ""), String(source.state["address"] || "")].filter(Boolean).join(" · ");
  await alert(client.tenantId, managers.map((m) => m.id), `FIAREP needs approval — $${total.toFixed(2)}`, ref, source.id);
  return { ok: true, quote };
}

/** FIAREP's administrator acts on a technician's quote: sends it to the
 *  client, or turns it back to the technician. */
export async function reviewQuote(
  actor: Actor,
  copy: Row,
  decision: "send" | "decline",
  note: string,
): Promise<{ ok: true; quote: Quote } | { ok: false; status: number; error: string }> {
  if (actor.tenantId !== FIAREP_TENANT || actor.role !== "administrator") {
    return { ok: false, status: 403, error: "Only FIAREP's administrator sends a quote on." };
  }
  const current = quoteOf(copy.state);
  if (!current) return { ok: false, status: 404, error: "There is no quote on this job." };
  if (current.status !== "admin_review") return { ok: false, status: 409, error: `This was already ${current.status === "pending" ? "sent to the client" : current.status}.` };
  const now = new Date();
  if (decision === "send") {
    return deliverToClient(actor, copy, { ...current, status: "pending", sentAt: now.toISOString() });
  }
  const quote: Quote = { ...current, status: "declined", decidedAt: now.toISOString(), decidedBy: actor.name, note: note.trim().slice(0, 500) };
  await db.update(entityRecords).set({ state: { ...copy.state, quote }, version: (copy.version ?? 1) + 1, updatedAt: now })
    .where(and(eq(entityRecords.id, copy.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
  await audit(actor, "resident-reports.quote-turned-back", `$${current.total.toFixed(2)}${note ? ` · ${note}` : ""}`, copy.id);
  const ref = [String(copy.state["complaintNo"] || ""), String(copy.state["address"] || "")].filter(Boolean).join(" · ");
  await alert(FIAREP_TENANT, [current.sentById || String(copy.state["assignedStaffId"] || "")],
    `${actor.name} turned the quote back${note ? `: ${note}` : ""}`, ref, copy.id);
  return { ok: true, quote };
}

/** The client approves or declines. Approval releases the work. */
export async function decideQuote(
  actor: Actor,
  source: Row,
  decision: "approve" | "decline",
  note: string,
): Promise<{ ok: true; quote: Quote } | { ok: false; status: number; error: string }> {
  const current = quoteOf(source.state);
  if (!current) return { ok: false, status: 404, error: "There is nothing to approve on this complaint." };
  if (current.status !== "pending") return { ok: false, status: 409, error: `This was already ${current.status}.` };

  const now = new Date();
  const quote: Quote = {
    ...current,
    status: decision === "approve" ? "approved" : "declined",
    decidedAt: now.toISOString(),
    decidedBy: actor.name,
    ...(decision === "decline" ? { note: note.trim().slice(0, 500) } : {}),
  };

  const fiarepId = String(source.state["fiarepRecordId"] || "");
  await db.transaction(async (tx) => {
    await tx.update(entityRecords).set({ state: { ...source.state, quote }, version: (source.version ?? 1) + 1, updatedAt: now })
      .where(and(eq(entityRecords.id, source.id), eq(entityRecords.tenantId, source.tenantId)));
    if (fiarepId) {
      const [copy] = await tx.select().from(entityRecords).where(and(
        eq(entityRecords.id, fiarepId), eq(entityRecords.tenantId, FIAREP_TENANT),
      )).limit(1);
      if (copy) {
        await tx.update(entityRecords).set({ state: { ...copy.state, quote }, version: (copy.version ?? 1) + 1, updatedAt: now })
          .where(and(eq(entityRecords.id, copy.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
      }
    }
  });
  await audit(actor, `resident-reports.quote-${decision}d`, `$${current.total.toFixed(2)}${note ? ` · ${note}` : ""}`, source.id);

  // FIAREP hears: the technician who priced it, and the office.
  const office = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"),
    inArray(staffAccounts.role, ["administrator", "management"]),
  ));
  const [company] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, source.tenantId)).limit(1);
  const who = company?.name || source.tenantId;
  const tech = String(source.state["assignedStaffId"] || "");
  const ref = [String(source.state["complaintNo"] || ""), String(source.state["address"] || "")].filter(Boolean).join(" · ");
  await alert(
    FIAREP_TENANT,
    [tech, ...office.map((o) => o.id)],
    decision === "approve" ? `${who} approved $${current.total.toFixed(2)} — go ahead` : `${who} declined the quote${note ? `: ${note}` : ""}`,
    ref,
    fiarepId || source.id,
  );
  return { ok: true, quote };
}
