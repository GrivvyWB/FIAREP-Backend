// Email for the Command Center: read the inbox, read one email, send email
// (with a saved report or a scope attached), and an address book.
//  - FIAREP's own Command Center uses FIAREP's Outlook (the Replit "outlook"
//    connector, Microsoft Graph) to read and send.
//  - A client connects its own mailbox (Command Center page → Email): email
//    address + app password, over IMAP (read) and SMTP (send). Gmail, Yahoo,
//    iCloud, and most hosting companies (GoDaddy, cPanel…) work this way.
//    The password is stored encrypted (AES-256-GCM, same as the API keys).
//  - A client with no mailbox of its own sends from FIAREP's Outlook (switch:
//    "Send from FIAREP's Outlook"), like FIAREP's other emails to vendors and
//    residents already do. A client never reads FIAREP's inbox.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, eq, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { db, entityRecords, organizations, settings } from "@workspace/db";
import { open, seal, type Sealed } from "./keys";
import { effectiveSwitches } from "./switches";
import { commandAuditLog } from "./audit";
import { getReport, findScope, listReports } from "./scopes";

const PLATFORM = "default";
const KEY = "command-mailbox";
const CONTACTS = "command-contacts";
const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isEmail = (v: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let connectors: ReplitConnectors | null = null;
const graph = () => (connectors ??= new ReplitConnectors());

// ── Mailbox settings ────────────────────────────────────────────────────────
export type MailboxConfig = { email: string; name: string; user: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number };
type Stored = MailboxConfig & { pass: Pick<Sealed, "iv" | "tag" | "data">; setAt: string; setBy: string };

/** Server settings for common providers, from the address's domain. */
export function presetFor(email: string): Partial<MailboxConfig> & { note?: string } {
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  if (["gmail.com", "googlemail.com"].includes(d)) return { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465, note: "Use a Google app password (Google Account → Security → 2-Step Verification → App passwords)." };
  if (["yahoo.com", "ymail.com"].includes(d)) return { imapHost: "imap.mail.yahoo.com", imapPort: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, note: "Use a Yahoo app password." };
  if (["icloud.com", "me.com", "mac.com"].includes(d)) return { imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587, note: "Use an Apple app-specific password." };
  if (["aol.com"].includes(d)) return { imapHost: "imap.aol.com", imapPort: 993, smtpHost: "smtp.aol.com", smtpPort: 465, note: "Use an AOL app password." };
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(d)) return { note: "Microsoft no longer lets Outlook.com / Microsoft 365 mailboxes connect with a password. This mailbox can't be connected this way." };
  return { imapHost: d ? `mail.${d}` : "", imapPort: 993, smtpHost: d ? `mail.${d}` : "", smtpPort: 465, note: "Check these with your email provider." };
}

async function stored(tenantId: string): Promise<Stored | null> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, KEY))).limit(1);
  const v = row?.value as Stored | undefined;
  return v && typeof v.email === "string" && v.pass ? v : null;
}

export async function mailStatus(tenantId: string) {
  const own = await stored(tenantId);
  const sw = await effectiveSwitches(tenantId);
  const platform = tenantId === PLATFORM;
  return {
    own: own ? { email: own.email, name: own.name, imapHost: own.imapHost, smtpHost: own.smtpHost, setAt: own.setAt, setBy: own.setBy } : null,
    reads: own ? own.email : platform ? "FIAREP's Outlook" : null,
    sends: own ? own.email : platform || sw.mailFallback ? "FIAREP's Outlook" : null,
  };
}

function imapFor(c: MailboxConfig, pass: string): ImapFlow {
  const client = new ImapFlow({ host: c.imapHost, port: c.imapPort, secure: c.imapPort === 993, auth: { user: c.user, pass }, logger: false, socketTimeout: 30_000, greetingTimeout: 15_000 } as never);
  // A dropped connection is reported as an 'error' event; without a listener it would stop the whole server.
  client.on("error", () => undefined);
  return client;
}
const smtpFor = (c: MailboxConfig, pass: string) => nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465, auth: { user: c.user, pass }, connectionTimeout: 15_000 });

/** Check both servers with the password, then save it (encrypted). */
export async function connectMailbox(tenantId: string, input: Partial<MailboxConfig> & { password?: string }, by: string): Promise<{ ok: true } | { error: string }> {
  const email = s(input.email, 200).toLowerCase();
  if (!isEmail(email)) return { error: "Enter the email address." };
  const pre = presetFor(email);
  const c: MailboxConfig = {
    email, name: s(input.name, 120), user: s(input.user, 200) || email,
    imapHost: s(input.imapHost, 200) || pre.imapHost || "", imapPort: Number(input.imapPort) || pre.imapPort || 993,
    smtpHost: s(input.smtpHost, 200) || pre.smtpHost || "", smtpPort: Number(input.smtpPort) || pre.smtpPort || 465,
  };
  const pass = typeof input.password === "string" ? input.password.trim() : "";
  if (!pass) return { error: "Enter the password (an app password for Gmail / Yahoo / iCloud)." };
  if (!c.imapHost || !c.smtpHost) return { error: pre.note || "Enter the mail servers." };
  const imap = imapFor(c, pass);
  try { await imap.connect(); await imap.logout(); }
  catch (e) { return { error: `Couldn't sign in to read mail (${c.imapHost}): ${e instanceof Error ? e.message : "failed"}. ${pre.note ?? ""}`.trim() }; }
  try { await smtpFor(c, pass).verify(); }
  catch (e) { return { error: `Couldn't sign in to send mail (${c.smtpHost}): ${e instanceof Error ? e.message : "failed"}.` }; }
  const now = new Date();
  const value: Stored = { ...c, pass: seal(pass), setAt: now.toISOString(), setBy: by };
  await db.insert(settings).values({ tenantId, key: KEY, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
  await commandAuditLog({ tenantId, actor: by, event: "mailbox.connected", detail: { email, imapHost: c.imapHost, smtpHost: c.smtpHost } });
  return { ok: true };
}

export async function disconnectMailbox(tenantId: string, by: string) {
  await db.delete(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, KEY)));
  await commandAuditLog({ tenantId, actor: by, event: "mailbox.disconnected", detail: {} });
}

async function ownWithPass(tenantId: string) {
  const own = await stored(tenantId);
  if (!own) return null;
  const pass = open({ ...own.pass, last4: "", setAt: "", setBy: "" });
  return pass ? { c: own, pass } : null;
}

// ── Reading ─────────────────────────────────────────────────────────────────
export type InboxItem = { id: string; from: string; fromName: string; subject: string; date: string; preview: string; unread: boolean };
export type InboxQuery = { unreadOnly?: boolean; from?: string; search?: string; limit?: number };

async function graphJson(path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  const r = await graph().proxy("outlook", path, { method: init.method ?? "GET", headers: { "content-type": "application/json", ...(init.headers ?? {}) }, body: init.body });
  const text = await r.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!r.ok) {
    const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`;
    throw new Error(r.status === 403 ? `FIAREP's Outlook connection isn't allowed to do that (${msg}). Reconnect Outlook in Replit with mail read permission.` : msg);
  }
  return data;
}

export async function readInbox(tenantId: string, q: InboxQuery): Promise<{ mailbox: string; emails: InboxItem[] } | { error: string }> {
  const limit = Math.min(25, Math.max(1, q.limit ?? 10));
  const own = await ownWithPass(tenantId);
  if (own) {
    const imap = imapFor(own.c, own.pass);
    try {
      await imap.connect();
      const lock = await imap.getMailboxLock("INBOX", { readOnly: true } as never);
      try {
        const crit: Record<string, unknown> = {};
        if (q.unreadOnly) crit["seen"] = false;
        if (q.from) crit["from"] = q.from;
        if (q.search) crit["text"] = q.search;
        const found = Object.keys(crit).length ? ((await imap.search(crit as never, { uid: true })) || []) : null;
        const uids = found ?? [];
        const range = found ? uids.slice(-limit).join(",") : `${Math.max(1, ((imap.mailbox as { exists?: number }).exists ?? 0) - limit + 1)}:*`;
        const out: InboxItem[] = [];
        if (range && (found ? uids.length : ((imap.mailbox as { exists?: number }).exists ?? 0) > 0)) {
          for await (const m of imap.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true, source: { start: 0, maxLength: 16_384 } } as never, { uid: !!found })) {
            const msg = m as unknown as { uid: number; envelope?: { subject?: string; from?: Array<{ address?: string; name?: string }> }; flags?: Set<string>; internalDate?: Date; source?: Buffer };
            const parsed = msg.source ? await simpleParser(msg.source).catch(() => null) : null;
            out.push({ id: `imap:${msg.uid}`, from: msg.envelope?.from?.[0]?.address ?? "", fromName: msg.envelope?.from?.[0]?.name ?? "", subject: msg.envelope?.subject ?? "", date: (msg.internalDate ?? new Date()).toISOString(),
              preview: (parsed?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200), unread: !msg.flags?.has("\\Seen") });
          }
        }
        return { mailbox: own.c.email, emails: out.reverse() };
      } finally { lock.release(); await imap.logout().catch(() => undefined); }
    } catch (e) { return { error: `Couldn't read ${own.c.email}: ${e instanceof Error ? e.message : "failed"}` }; }
  }
  if (tenantId !== PLATFORM) return { error: "This organization hasn't connected a mailbox. Connect one on the Command Center page (Email)." };
  try {
    const sel = "$select=id,subject,from,receivedDateTime,bodyPreview,isRead";
    let path: string;
    if (q.search || q.from) {
      const term = [q.search, q.from ? `from:${q.from}` : ""].filter(Boolean).join(" ").replace(/"/g, "");
      path = `/v1.0/me/mailFolders/inbox/messages?${sel}&$top=${limit}&$search=${encodeURIComponent(`"${term}"`)}`;
    } else {
      path = `/v1.0/me/mailFolders/inbox/messages?${sel}&$top=${limit}&$orderby=receivedDateTime%20desc${q.unreadOnly ? `&$filter=${encodeURIComponent("isRead eq false")}` : ""}`;
    }
    const data = await graphJson(path) as { value?: Array<{ id: string; subject?: string; from?: { emailAddress?: { address?: string; name?: string } }; receivedDateTime?: string; bodyPreview?: string; isRead?: boolean }> };
    let emails = (data.value ?? []).map((m) => ({ id: m.id, from: m.from?.emailAddress?.address ?? "", fromName: m.from?.emailAddress?.name ?? "", subject: m.subject ?? "", date: m.receivedDateTime ?? "", preview: (m.bodyPreview ?? "").slice(0, 200), unread: m.isRead === false }));
    if (q.unreadOnly && (q.search || q.from)) emails = emails.filter((e) => e.unread);
    return { mailbox: "FIAREP's Outlook", emails };
  } catch (e) { return { error: `Couldn't read FIAREP's Outlook: ${e instanceof Error ? e.message : "failed"}` }; }
}

export async function readEmail(tenantId: string, id: string) {
  const own = await ownWithPass(tenantId);
  if (id.startsWith("imap:")) {
    if (!own) return { error: "No mailbox connected." };
    const imap = imapFor(own.c, own.pass);
    try {
      await imap.connect();
      const lock = await imap.getMailboxLock("INBOX", { readOnly: true } as never);
      try {
        const m = await imap.fetchOne(id.slice(5), { source: true, uid: true } as never, { uid: true }) as unknown as { source?: Buffer } | false;
        if (!m || !m.source) return { error: "That email isn't in the inbox any more." };
        const p = await simpleParser(m.source);
        const addr = (a: unknown) => { const v = a as { value?: Array<{ address?: string; name?: string }> } | undefined; return (v?.value ?? []).map((x) => x.name ? `${x.name} <${x.address}>` : x.address ?? "").join(", "); };
        return { id, from: addr(p.from), to: addr(p.to), subject: p.subject ?? "", date: (p.date ?? new Date()).toISOString(), text: (p.text ?? "").slice(0, 8000), attachments: p.attachments.map((a) => a.filename ?? "file") };
      } finally { lock.release(); await imap.logout().catch(() => undefined); }
    } catch (e) { return { error: `Couldn't read it: ${e instanceof Error ? e.message : "failed"}` }; }
  }
  if (own || tenantId !== PLATFORM) return { error: "No email with that id." };
  try {
    const m = await graphJson(`/v1.0/me/messages/${encodeURIComponent(id)}?$select=subject,from,toRecipients,receivedDateTime,body,hasAttachments`, { headers: { Prefer: 'outlook.body-content-type="text"' } }) as { subject?: string; from?: { emailAddress?: { address?: string; name?: string } }; toRecipients?: Array<{ emailAddress?: { address?: string } }>; receivedDateTime?: string; body?: { content?: string }; hasAttachments?: boolean };
    return { id, from: `${m.from?.emailAddress?.name ?? ""} <${m.from?.emailAddress?.address ?? ""}>`.trim(), to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address ?? "").join(", "), subject: m.subject ?? "", date: m.receivedDateTime ?? "", text: (m.body?.content ?? "").slice(0, 8000), hasAttachments: m.hasAttachments === true };
  } catch (e) { return { error: `Couldn't read it: ${e instanceof Error ? e.message : "failed"}` }; }
}

// ── Address book ────────────────────────────────────────────────────────────
export type Contact = { name: string; email: string; from: string };

async function savedContacts(tenantId: string): Promise<Contact[]> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, CONTACTS))).limit(1);
  const list = Array.isArray(row?.value) ? (row!.value as Array<{ name?: string; email?: string; note?: string }>) : [];
  return list.filter((c) => c.email).map((c) => ({ name: s(c.name, 120), email: s(c.email, 200), from: c.note ? `saved (${s(c.note, 60)})` : "saved" }));
}

export async function saveContact(tenantId: string, name: string, email: string, note: string, by: string) {
  const e = s(email, 200).toLowerCase();
  if (!isEmail(e)) return { error: "That isn't an email address." };
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, CONTACTS))).limit(1);
  const list = (Array.isArray(row?.value) ? row!.value : []) as Array<{ name: string; email: string; note?: string }>;
  const next = [...list.filter((c) => c.email.toLowerCase() !== e), { name: s(name, 120), email: e, note: s(note, 60) }].slice(-500);
  const now = new Date();
  await db.insert(settings).values({ tenantId, key: CONTACTS, value: next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: next, updatedAt: now } });
  await commandAuditLog({ tenantId, actor: by, event: "contact.saved", detail: { name: s(name, 120), email: e } });
  return { saved: { name: s(name, 120), email: e } };
}

/** Everyone with an email this organization has: saved contacts, staff (HR records), contractors, the HR mailbox. */
export async function allContacts(tenantId: string): Promise<Contact[]> {
  const out: Contact[] = [...await savedContacts(tenantId)];
  const rows = await db.select({ entity: entityRecords.entity, state: entityRecords.state }).from(entityRecords)
    .where(and(eq(entityRecords.tenantId, tenantId), eq(entityRecords.deleted, false), sql`${entityRecords.entity} in ('hr-employee-records','vendor-contacts')`));
  for (const r of rows) {
    const email = s(r.state["email"], 200);
    if (!isEmail(email)) continue;
    const name = s(r.state["name"], 120) || [s(r.state["firstName"], 60), s(r.state["lastName"], 60)].filter(Boolean).join(" ");
    out.push({ name, email, from: r.entity === "vendor-contacts" ? `contractor${s(r.state["company"], 80) ? ` · ${s(r.state["company"], 80)}` : ""}` : `staff${s(r.state["position"], 60) ? ` · ${s(r.state["position"], 60)}` : ""}` });
  }
  const [org] = await db.select({ hrEmail: organizations.hrEmail }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  if (org?.hrEmail && isEmail(org.hrEmail)) out.push({ name: "HR", email: org.hrEmail, from: "HR mailbox" });
  const seen = new Set<string>();
  return out.filter((c) => { const k = c.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function findContacts(tenantId: string, query: string): Promise<Contact[]> {
  const q = query.trim().toLowerCase();
  const all = await allContacts(tenantId);
  if (!q) return all.slice(0, 50);
  const words = q.split(/\s+/);
  return all.filter((c) => { const hay = `${c.name} ${c.email} ${c.from}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, 20);
}

/** Names or addresses → addresses. A name must match exactly one contact. */
export async function resolveRecipients(tenantId: string, wanted: string[]): Promise<{ to: Contact[] } | { error: string }> {
  const to: Contact[] = [];
  for (const w of wanted.map((x) => s(x, 200)).filter(Boolean)) {
    const angle = /<([^>]+)>/.exec(w)?.[1];
    const addr = angle ?? w;
    if (isEmail(addr)) { to.push({ name: angle ? w.replace(/<[^>]+>/, "").trim() : "", email: addr, from: "typed" }); continue; }
    const hits = await findContacts(tenantId, w);
    const exact = hits.filter((h) => h.name.toLowerCase() === w.toLowerCase());
    const pick = exact.length === 1 ? exact : hits;
    if (pick.length === 1) { to.push(pick[0]!); continue; }
    if (!pick.length) return { error: `No email for "${w}". Give their address (and save it with save_contact).` };
    return { error: `"${w}" matches more than one: ${pick.slice(0, 6).map((h) => `${h.name} <${h.email}> (${h.from})`).join("; ")}. Say which.` };
  }
  return { to };
}

// ── Sending ─────────────────────────────────────────────────────────────────
type Attachment = { name: string; html: string };

/** A saved report or a scope of work, as an HTML file to attach. */
export async function attachmentFor(tenantId: string, ref: string): Promise<Attachment | { error: string }> {
  const r = ref.trim();
  const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.5;color:#0f172a}h2{font-size:17px;margin:20px 0 6px}li{margin-left:18px}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
  const lines = (t: string) => t.split("\n").map((l) => l.startsWith("# ") ? `<h2>${esc(l.slice(2))}</h2>` : l.startsWith("- ") ? `<li>${esc(l.slice(2))}</li>` : l.trim() ? `<p>${esc(l)}</p>` : "").join("");
  const byTitle = /^[0-9a-f-]{36}$/i.test(r) ? null : (await listReports(tenantId, 200)).find((x) => x.title.toLowerCase() === r.toLowerCase());
  const rep = await getReport(tenantId, byTitle?.id ?? r).catch(() => null);
  if (rep) return { name: `${rep.title.replace(/[^\w .-]+/g, "").slice(0, 60) || "Report"}.html`, html: rep.body.startsWith("<!doctype html>") ? rep.body : page(rep.title, lines(rep.body)) };
  const sc = await findScope(tenantId, r);
  if (sc) {
    const st = sc.state;
    const items = ((st["cpmEstimate"] as { categories?: Array<{ title?: string; location?: string; description?: string }> } | undefined)?.categories ?? [])
      .map((c) => `<li><b>${esc(String(c.title ?? ""))}</b>${c.location ? ` — ${esc(String(c.location))}` : ""}${c.description ? `: ${esc(String(c.description))}` : ""}</li>`).join("");
    const code = String(st["trackingId"] ?? "");
    return { name: `Scope ${code}.html`, html: page(`Scope of work ${code}`, `<p><b>Address:</b> ${esc(String(st["address"] ?? ""))}</p>${lines(String(st["scope"] ?? ""))}${items ? `<h2>Items</h2><ul>${items}</ul>` : ""}${st["bidCloseAt"] ? `<p><b>Bids close:</b> ${esc(String(st["bidCloseAt"]))}</p>` : ""}`) };
  }
  return { error: `Nothing to attach called "${r}" (give a saved report's title or id, or a scope code).` };
}

export async function sendEmail(tenantId: string, m: { to: Contact[]; cc: Contact[]; subject: string; body: string; attachments: Attachment[] }, by: string, runId?: string) {
  const html = m.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const own = await ownWithPass(tenantId);
  let via: string;
  if (own) {
    await smtpFor(own.c, own.pass).sendMail({
      from: own.c.name ? `"${own.c.name.replace(/"/g, "")}" <${own.c.email}>` : own.c.email,
      to: m.to.map((c) => c.email), cc: m.cc.map((c) => c.email), subject: m.subject, text: m.body, html,
      attachments: m.attachments.map((a) => ({ filename: a.name, content: a.html, contentType: "text/html" })),
    });
    via = own.c.email;
  } else {
    if (tenantId !== PLATFORM && !(await effectiveSwitches(tenantId)).mailFallback) return { error: "No mailbox is connected and sending from FIAREP's Outlook is switched off. Connect a mailbox on the Command Center page." };
    await graphJson("/v1.0/me/sendMail", { method: "POST", body: JSON.stringify({ message: {
      subject: m.subject, body: { contentType: "HTML", content: html },
      toRecipients: m.to.map((c) => ({ emailAddress: { address: c.email, ...(c.name ? { name: c.name } : {}) } })),
      ccRecipients: m.cc.map((c) => ({ emailAddress: { address: c.email } })),
      attachments: m.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: "text/html", contentBytes: Buffer.from(a.html).toString("base64") })),
    }, saveToSentItems: true }) });
    via = "FIAREP's Outlook";
  }
  await commandAuditLog({ tenantId, actor: by, runId, event: "email.sent", detail: { via, to: m.to.map((c) => c.email), cc: m.cc.map((c) => c.email), subject: m.subject, attachments: m.attachments.map((a) => a.name) } });
  return { sent: true, from: via, to: m.to.map((c) => c.email), cc: m.cc.map((c) => c.email), subject: m.subject, attached: m.attachments.map((a) => a.name) };
}
