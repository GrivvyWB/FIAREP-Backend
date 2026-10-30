// Monthly autopay through Square.
//
// After a client signs their contract, the signing page offers "Set up monthly autopay": the card is
// taken by Square's own card form (FIAREP never sees the number), kept on file at Square, the first
// month is charged right away, and the same amount is charged every month on that day after. Square
// deposits the payments in the bank account connected to FIAREP's Square account.
//
// Replit Secrets: SQUARE_ACCESS_TOKEN, SQUARE_APPLICATION_ID, SQUARE_LOCATION_ID, and SQUARE_ENV
// ("sandbox" to test; anything else = live). Each client's autopay has an On/Off switch in Platform
// Control → Billing.
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";

const TENANT = "default";
const ENTITY = "autopay";
const VERSION = "2024-10-17";

export const squareConfig = () => {
  const sandbox = (process.env["SQUARE_ENV"] || "").toLowerCase() === "sandbox";
  return {
    token: process.env["SQUARE_ACCESS_TOKEN"] || "", appId: process.env["SQUARE_APPLICATION_ID"] || "", locationId: process.env["SQUARE_LOCATION_ID"] || "",
    sandbox, api: sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com",
    sdk: sandbox ? "https://sandbox.web.squarecdn.com/v1/square.js" : "https://web.squarecdn.com/v1/square.js",
  };
};
export const squareReady = () => { const c = squareConfig(); return !!(c.token && c.appId && c.locationId); };

async function square<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const c = squareConfig();
  const r = await fetch(`${c.api}${path}`, {
    method, signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${c.token}`, "Square-Version": VERSION, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { errors?: Array<{ detail?: string; code?: string }> } & T;
  if (!r.ok || j.errors?.length) throw new Error(j.errors?.map((e) => e.detail || e.code).join("; ") || `Square answered ${r.status}`);
  return j;
}

export type Charge = { period: string; amount: number; at: string; status: "paid" | "failed"; paymentId?: string; receiptUrl?: string; error?: string };
export type Autopay = {
  orgId: string | null; company: string; contractNumber: string; signingId: string; email: string; contact: string;
  monthly: number; customerId: string; cardId: string; card: string; day: number; nextChargeOn: string; on: boolean;
  charges: Charge[]; createdAt: string;
};

const cents = (usd: number) => Math.round(usd * 100);
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** The same day next month (the 31st becomes the last day of a shorter month). */
function nextMonth(fromYmd: string, day: number) {
  const [y, m] = fromYmd.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

async function charge(id: string, a: Autopay, period: string): Promise<Charge> {
  const c = squareConfig();
  // One key per client per month: a month is never charged twice, even if two servers try.
  const key = createHash("sha256").update(`fiarep-autopay:${id}:${period}`).digest("hex").slice(0, 40);
  try {
    const r = await square<{ payment: { id: string; status: string; receipt_url?: string } }>("/v2/payments", {
      idempotency_key: key, source_id: a.cardId, customer_id: a.customerId, location_id: c.locationId,
      amount_money: { amount: cents(a.monthly), currency: "USD" }, autocomplete: true,
      buyer_email_address: a.email || undefined, reference_id: a.contractNumber.slice(0, 40),
      note: `FIAREP ${a.company} — ${period}`.slice(0, 500),
    });
    const ok = r.payment.status === "COMPLETED" || r.payment.status === "APPROVED";
    return { period, amount: a.monthly, at: new Date().toISOString(), status: ok ? "paid" : "failed", paymentId: r.payment.id, receiptUrl: r.payment.receipt_url, ...(ok ? {} : { error: r.payment.status }) };
  } catch (e) {
    return { period, amount: a.monthly, at: new Date().toISOString(), status: "failed", error: e instanceof Error ? e.message : "Charge failed" };
  }
}

async function tellAdministrators(title: string, detail: string) {
  const { notify } = await import("./audit");
  const system = { id: "billing", tenantId: TENANT, name: "Billing", role: "administrator", position: "", developments: [], sessionVersion: 0 };
  await notify(system as never, "administrator", title, detail).catch(() => undefined);
}

/** The client put a card on the signing page: keep it at Square, charge the first month, schedule the rest. */
export async function enroll(signing: { id: string; orgId?: string | null; company: string; contact: string; email: string; number: string; monthly: number }, sourceId: string) {
  if (!squareReady()) return { error: "Autopay isn't set up yet. FIAREP will send an invoice." };
  const [existing] = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, TENANT), eq(entityRecords.entity, ENTITY), eq(entityRecords.id, `autopay-${signing.id}`))).limit(1);
  if (existing) return { error: "Autopay is already set up for this agreement." };
  try {
    const cust = await square<{ customer: { id: string } }>("/v2/customers", {
      idempotency_key: randomUUID(), company_name: signing.company.slice(0, 100), given_name: signing.contact.slice(0, 100), email_address: signing.email || undefined, reference_id: signing.number.slice(0, 40),
    });
    const card = await square<{ card: { id: string; card_brand?: string; last_4?: string } }>("/v2/cards", {
      idempotency_key: randomUUID(), source_id: sourceId, card: { customer_id: cust.customer.id, reference_id: signing.number.slice(0, 40) },
    });
    const today = ymd(new Date());
    const day = Number(today.slice(8, 10));
    const id = `autopay-${signing.id}`;
    const a: Autopay = {
      orgId: signing.orgId ?? null, company: signing.company, contractNumber: signing.number, signingId: signing.id, email: signing.email, contact: signing.contact,
      monthly: signing.monthly, customerId: cust.customer.id, cardId: card.card.id, card: `${card.card.card_brand || "Card"} •••• ${card.card.last_4 || ""}`.trim(),
      day, nextChargeOn: nextMonth(today, day), on: true, charges: [], createdAt: new Date().toISOString(),
    };
    const first = await charge(id, a, today.slice(0, 7));
    a.charges.push(first);
    await db.insert(entityRecords).values({ id, tenantId: TENANT, entity: ENTITY, state: a, createdBy: "Contract signing" });
    await tellAdministrators(`Autopay set up: ${a.company}`, `${a.card} · $${a.monthly.toLocaleString("en-US")} a month · first payment ${first.status}${first.error ? ` (${first.error})` : ""}`);
    return { enrolled: true, card: a.card, monthly: a.monthly, firstPayment: first.status, nextChargeOn: a.nextChargeOn, ...(first.error ? { error: `Card saved, but the first payment didn't go through: ${first.error}` } : {}) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Square couldn't save the card." };
  }
}

/** Charge everyone whose day has come (runs every hour). A failed month is tried again in 3 days. */
export async function runBilling() {
  if (!squareReady()) return;
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, TENANT), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false)));
  const today = ymd(new Date());
  for (const row of rows) {
    const a = row.state as unknown as Autopay;
    if (!a.on || !a.nextChargeOn || a.nextChargeOn > today) continue;
    const period = a.nextChargeOn.slice(0, 7);
    const c = await charge(row.id, a, period);
    const charges = [...a.charges.filter((x) => !(x.period === period && x.status === "failed")), c].slice(-36);
    const retry = new Date(Date.now() + 3 * 86_400_000);
    const next: Autopay = { ...a, charges, nextChargeOn: c.status === "paid" ? nextMonth(a.nextChargeOn, a.day) : ymd(retry) };
    await db.update(entityRecords).set({ state: next as never, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
    if (c.status === "failed") await tellAdministrators(`Autopay failed: ${a.company}`, `${a.card} · $${a.monthly.toLocaleString("en-US")} for ${period}: ${c.error}. Trying again ${ymd(retry)}.`);
  }
}

export function startBilling() {
  setTimeout(() => { void runBilling().catch(() => undefined); }, 2 * 60_000).unref();
  setInterval(() => { void runBilling().catch(() => undefined); }, 3_600_000).unref();
}

export async function autopayList() {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, TENANT), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false)));
  return rows.map((r) => { const a = r.state as unknown as Autopay; return { id: r.id, company: a.company, contractNumber: a.contractNumber, card: a.card, monthly: a.monthly, nextChargeOn: a.nextChargeOn, on: a.on, last: a.charges[a.charges.length - 1] ?? null, paidTotal: a.charges.filter((c) => c.status === "paid").reduce((n, c) => n + c.amount, 0) }; })
    .sort((x, y) => x.company.localeCompare(y.company));
}
export async function setAutopayOn(id: string, on: boolean) {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.tenantId, TENANT), eq(entityRecords.entity, ENTITY))).limit(1);
  if (!row) return { error: "Not found" };
  await db.update(entityRecords).set({ state: { ...(row.state as Record<string, unknown>), on }, updatedAt: new Date() }).where(eq(entityRecords.id, id));
  return { ok: true };
}
export async function enrolledFor(signingId: string) {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, `autopay-${signingId}`), eq(entityRecords.tenantId, TENANT))).limit(1);
  const a = row?.state as unknown as Autopay | undefined;
  return a ? { card: a.card, monthly: a.monthly, nextChargeOn: a.nextChargeOn, on: a.on } : null;
}
