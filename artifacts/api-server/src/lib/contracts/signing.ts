// Contracts signed on the phone or computer.
//
// FIAREP's side is signed with the owner's saved signature (drawn once in Platform Control →
// Repair prices → My signature). The client gets a link, reads the agreement, taps "I agree" and
// signs with a finger or mouse; the signed copy goes to the client and to FIAREP's mailbox.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";

const TENANT = "default";
const ENTITY = "contract-signing";
const OWNER_SIG = "owner-signature";

export type OwnerSignature = { image: string; name: string; savedAt: string };
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export async function ownerSignature(): Promise<OwnerSignature | null> {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, OWNER_SIG), eq(entityRecords.tenantId, TENANT))).limit(1);
  const s = row?.state as Partial<OwnerSignature> | undefined;
  return s?.image && PNG.test(s.image) ? { image: s.image, name: String(s.name || ""), savedAt: String(s.savedAt || "") } : null;
}
export async function saveOwnerSignature(image: string, name: string): Promise<OwnerSignature | { error: string }> {
  if (!PNG.test(image) || image.length > 400_000) return { error: "Draw your signature first." };
  const state: OwnerSignature = { image, name: name.trim().slice(0, 120) || "Tim Winn", savedAt: new Date().toISOString() };
  await db.insert(entityRecords).values({ id: OWNER_SIG, tenantId: TENANT, entity: OWNER_SIG, state })
    .onConflictDoUpdate({ target: entityRecords.id, set: { state, updatedAt: new Date() } });
  return state;
}

const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });

/** Put a signature (image) and the date on one side of the agreement's signature block (0 = FIAREP, 1 = client). */
function signSide(html: string, side: 0 | 1, image: string, when: Date, note = ""): string {
  let n = -1;
  return html.replace(/<div class="line">Signature<\/div><div class="line">([\s\S]*?)<br>Date<\/div>/g, (whole, who: string) => {
    n += 1;
    if (n !== side) return whole;
    return `<img src="${image}" alt="Signature" style="height:56px;max-width:100%;display:block;margin-top:8px"><div class="line" style="margin-top:2px">Signature${note ? ` <span style="color:#555">· ${esc(note)}</span>` : ""}</div><div class="line">${who}<br>Date: ${esc(day(when))}</div>`;
  });
}

export type Signing = {
  token: string; number: string; company: string; contact: string; email: string; kind: string; monthly: number; orgId?: string | null;
  html: string; status: "sent" | "signed"; sentAt: string; signedAt?: string; signedName?: string; ip?: string; userAgent?: string; agreed?: string;
};

/** Sign FIAREP's side and keep the agreement for the client to sign. */
export async function startSigning(html: string, info: { number: string; company: string; contact: string; email: string; kind: string; monthly: number; orgId?: string | null }, by: string) {
  const sig = await ownerSignature();
  if (!sig) return { error: "Your signature isn't saved yet. Draw it once in Platform Control → Repair prices → My signature, then ask again." };
  const id = randomUUID(); const token = randomBytes(24).toString("base64url");
  const state: Signing = { token, ...info, html: signSide(html, 0, sig.image, new Date()), status: "sent", sentAt: new Date().toISOString() };
  await db.insert(entityRecords).values({ id, tenantId: TENANT, entity: ENTITY, state, createdBy: by });
  return { id, token, link: `https://fiarep.com/sign/${id}?t=${token}` };
}

async function load(id: string, token: string) {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.tenantId, TENANT), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false))).limit(1);
  const s = row?.state as Signing | undefined;
  if (!s?.token || !token) return null;
  const a = Buffer.from(s.token); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? s : null;
}

/** What monthly autopay needs from a signed agreement (null unless the link is valid and it is signed). */
export async function signedForAutopay(id: string, token: string) {
  const s = await load(id, token);
  return s && s.status === "signed" ? { id, orgId: s.orgId ?? null, company: s.company, contact: s.contact, email: s.email, number: s.number, monthly: s.monthly } : null;
}

export async function signingView(id: string, token: string) {
  const s = await load(id, token);
  if (!s) return null;
  return { number: s.number, company: s.company, contact: s.contact, status: s.status, signedAt: s.signedAt ?? null, signedName: s.signedName ?? null, monthly: s.monthly, html: s.html };
}

/** The client agreed and signed. */
export async function clientSigns(id: string, token: string, input: { name: string; image: string; agree: boolean; ip: string; userAgent: string }) {
  const s = await load(id, token);
  if (!s) return { error: "This signing link isn't valid." };
  if (s.status === "signed") return { error: "This agreement is already signed." };
  if (!input.agree) return { error: "Tick \"I have read and agree\" first." };
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) return { error: "Type your full name." };
  if (!PNG.test(input.image) || input.image.length > 400_000) return { error: "Sign in the box first." };
  const now = new Date();
  const agreed = `I have read and agree to FIAREP Agreement ${s.number}.`;
  // FIAREP's side is already signed, so the client's is the one blank signature block left (the first match).
  const html = signSide(s.html, 0, input.image, now, `signed electronically by ${name}`)
    .replace("</div></body></html>", `<p class="muted" style="margin-top:10px">Signed electronically by ${esc(name)} on ${esc(now.toLocaleString("en-US", { timeZone: "America/New_York" }))} ET from ${esc(input.ip)}. "${esc(agreed)}"</p></div></body></html>`);
  const next: Signing = { ...s, html, status: "signed", signedAt: now.toISOString(), signedName: name, ip: input.ip, userAgent: input.userAgent.slice(0, 300), agreed };
  await db.update(entityRecords).set({ state: next, updatedAt: now, version: 2 }).where(eq(entityRecords.id, id));
  // The signed copy: to the client and to FIAREP's mailbox.
  const { sendEmail } = await import("../command/mail");
  const { BRAND } = await import("./contract");
  const mine = (process.env["FIAREP_OWNER_EMAIL"] || BRAND.email).trim();
  const copy = [{ name: `FIAREP Agreement ${s.number} - ${s.company} (signed).html`, html }];
  const to = [{ name: s.contact, email: s.email, from: "" }, ...(mine && mine !== s.email ? [{ name: "FIAREP", email: mine, from: "" }] : [])];
  await sendEmail(TENANT, { to, cc: [], attachments: copy, subject: `Signed: FIAREP Agreement ${s.number} — ${s.company}`, body: `Agreement ${s.number} between FIAREP and ${s.company} is signed by both sides.\n\nThe signed copy is attached.\n\nFIAREP\n${BRAND.site}` }, "Contract signing").catch(() => undefined);
  return { signed: true, number: s.number, company: s.company, signedAt: next.signedAt };
}
