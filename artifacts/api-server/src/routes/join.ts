// "Join FIAREP": a management company, owner or agency asks to pilot the
// service. Saved for the platform owner and emailed to FIAREP. Once the
// owner approves it, the requester gets an access code that unlocks the
// estimator on the Join page.
import { randomInt, randomUUID } from "node:crypto";

// 3-character access code, letters and numbers, case-sensitive (k3L, 3tT).
// No 0/O or 1/l/I so it reads the same on paper and on a phone.
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newAccessCode = () => Array.from({ length: 3 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { rateLimit } from "../lib/rateLimit";
import { requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";

const connectors = new ReplitConnectors();
const JOIN_INBOX = process.env["JOIN_REQUEST_EMAIL"] || "fiarep@outlook.com";
const SITE = (process.env["PUBLIC_WEB_URL"] || "https://fiarep.com").replace(/\/$/, "");
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const ENTITY = "join-requests";
const CODE_ENTITY = "join-codes";

type Development = { name: string; address: string; units: string };

async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }),
    });
    return response.ok;
  } catch { return false; }
}

const publicView = (row: typeof entityRecords.$inferSelect) => ({
  id: row.id,
  status: String(row.state["status"] || "new"),
  company: String(row.state["company"] || ""),
  // The code travels only once the owner approved — and only to the browser
  // that filed the request (it knows the id) or by email.
  accessCode: String(row.state["status"] || "") === "approved" ? String(row.state["accessCode"] || "") : "",
  // Contact on file — the Join page locks job requests to this email; only Platform Control changes it.
  contactName: String(row.state["contactName"] || ""),
  email: String(row.state["email"] || ""),
  phone: String(row.state["phone"] || ""),
});

const router: IRouter = Router();
router.use("/v1/public/join-requests", rateLimit("join-requests", 20));

router.post("/v1/public/join-requests", async (req, res) => {
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const company = str(b["company"], 200);
  const contactName = str(b["contactName"], 200);
  const phone = str(b["phone"], 60);
  const email = str(b["email"], 200).toLowerCase();
  const address = str(b["address"], 300);
  const portfolioSize = str(b["portfolioSize"], 60);
  const services = Array.isArray(b["services"]) ? b["services"].map((s) => str(s, 80)).filter(Boolean).slice(0, 30) : [];
  const notes = str(b["notes"], 2000);
  const developments: Development[] = (Array.isArray(b["developments"]) ? b["developments"] : [])
    .map((d) => (d && typeof d === "object" ? d : {}) as Record<string, unknown>)
    .map((d) => ({ name: str(d["name"], 200), address: str(d["address"], 300), units: str(d["units"], 20) }))
    .filter((d) => d.name || d.address)
    .slice(0, 50);
  if (!company || !contactName || (!phone && !email)) {
    res.status(400).json({ error: "Company, contact name, and a phone or email are required" });
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email" }); return; }
  const now = new Date();
  const id = randomUUID();
  const state = { company, contactName, phone, email, address, portfolioSize, developments, services, notes, status: "new", createdAt: now.toISOString() };
  await db.insert(entityRecords).values({
    id, tenantId: "default", entity: ENTITY, development: company, state,
    createdBy: "public-join", createdAt: now, updatedAt: now,
  });
  const rows = developments.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.name)}</td><td>${esc(d.address)}</td><td>${esc(d.units)}</td></tr>`).join("");
  const emailed = await sendMail(JOIN_INBOX, `Join FIAREP: ${company} (${developments.length} development${developments.length === 1 ? "" : "s"})`, [
    `<h2>${esc(company)} wants to pilot FIAREP</h2>`,
    `<p><strong>Contact:</strong> ${esc(contactName)}<br><strong>Phone:</strong> ${esc(phone)}<br><strong>Email:</strong> ${esc(email)}<br><strong>Office:</strong> ${esc(address)}</p>`,
    `<p><strong>Portfolio size:</strong> ${esc(portfolioSize)}</p>`,
    rows ? `<table border="1" cellpadding="6" cellspacing="0"><tr><th>#</th><th>Development</th><th>Address</th><th>Units</th></tr>${rows}</table>` : "<p>No developments listed.</p>",
    services.length ? `<p><strong>Services wanted:</strong> ${services.map(esc).join(", ")}</p>` : "",
    notes ? `<p><strong>Notes:</strong><br>${esc(notes).replaceAll("\n", "<br>")}</p>` : "",
    `<p>Approve it in Platform Control → Join requests: <a href="${SITE}/platform-owner/join-requests">${SITE}/platform-owner/join-requests</a></p>`,
    `<p style="color:#666;font-size:12px">Request ${id} · ${now.toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>`,
  ].join(""));
  res.status(201).json({ ok: true, id, status: "new", emailed });
});

// The browser that filed the request checks whether it was approved.
router.get("/v1/public/join-requests/:id", async (req, res) => {
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, String(req.params.id || "")), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false),
  )).limit(1);
  res.setHeader("Cache-Control", "no-store");
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  res.json(publicView(row));
});

// An approved company types its access code (from the approval email) on any device. Case-sensitive.
router.post("/v1/public/join-requests/unlock", async (req, res) => {
  const code = String((req.body as Record<string, unknown> | undefined)?.["code"] ?? "").trim();
  res.setHeader("Cache-Control", "no-store");
  if (!/^[A-Za-z0-9]{3}$/.test(code)) { res.status(400).json({ error: "The access code is 3 letters or numbers." }); return; }
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false),
    sql`${entityRecords.state}->>'accessCode' = ${code}`, sql`${entityRecords.state}->>'status' = 'approved'`,
  )).limit(1);
  if (row) { res.json(publicView(row)); return; }
  // Demo / sales codes made in Platform Control: unlock without a request.
  const [demo] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, CODE_ENTITY), eq(entityRecords.deleted, false),
    sql`${entityRecords.state}->>'accessCode' = ${code}`, sql`${entityRecords.state}->>'active' = 'true'`,
  )).limit(1);
  if (demo) {
    await db.update(entityRecords).set({ state: { ...demo.state, uses: Number(demo.state["uses"] || 0) + 1, lastUsedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(entityRecords.id, demo.id));
    res.json({ id: demo.id, status: "approved", company: String(demo.state["label"] || "FIAREP demo"), accessCode: code });
    return;
  }
  res.status(404).json({ error: "That access code isn't recognized or hasn't been approved yet." });
});

// ── Platform Control: review and approve ──
router.use("/v1/platform/join-requests", requirePlatformOwner);

router.get("/v1/platform/join-requests", async (_req, res) => {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false)))
    .orderBy(desc(entityRecords.createdAt)).limit(500);
  res.setHeader("Cache-Control", "no-store");
  res.json(rows.map((r) => ({ id: r.id, createdAt: r.createdAt, ...r.state })));
});

// ── Demo / sales codes: unlock the estimator for FIAREP's own people ──
router.use("/v1/platform/join-codes", requirePlatformOwner);
const codeOut = (r: typeof entityRecords.$inferSelect) => ({ id: r.id, label: String(r.state["label"] || ""), accessCode: String(r.state["accessCode"] || ""), active: r.state["active"] === true, uses: Number(r.state["uses"] || 0), lastUsedAt: r.state["lastUsedAt"] || null, createdAt: r.createdAt, createdBy: String(r.state["createdBy"] || "") });

router.get("/v1/platform/join-codes", async (_req, res) => {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, CODE_ENTITY), eq(entityRecords.deleted, false))).orderBy(desc(entityRecords.createdAt)).limit(200);
  res.setHeader("Cache-Control", "no-store");
  res.json(rows.map(codeOut));
});

router.post("/v1/platform/join-codes", async (req, res) => {
  const label = str((req.body as Record<string, unknown> | undefined)?.["label"], 80) || "Demo";
  const owner = res.locals["platformOwner"] as { name: string };
  const now = new Date();
  // Unique against every live code, request or demo.
  let accessCode = newAccessCode();
  for (let i = 0; i < 20; i++) {
    const [clash] = await db.select({ id: entityRecords.id }).from(entityRecords).where(and(eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'accessCode' = ${accessCode}`)).limit(1);
    if (!clash) break;
    accessCode = newAccessCode();
  }
  const [row] = await db.insert(entityRecords).values({
    id: randomUUID(), tenantId: "default", entity: CODE_ENTITY, development: null,
    state: { label, accessCode, active: true, uses: 0, createdBy: owner.name, createdAt: now.toISOString() },
    createdBy: "platform-owner", createdAt: now, updatedAt: now,
  }).returning();
  await platformAudit(owner.name, "join-code.created", row!.id, null, row);
  res.status(201).json(codeOut(row!));
});

router.post("/v1/platform/join-codes/:id/revoke", async (req, res) => {
  const [before] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params.id || "")), eq(entityRecords.entity, CODE_ENTITY))).limit(1);
  if (!before) { res.status(404).json({ error: "Code not found" }); return; }
  const owner = res.locals["platformOwner"] as { name: string };
  const [row] = await db.update(entityRecords).set({ state: { ...before.state, active: false, revokedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(entityRecords.id, before.id)).returning();
  await platformAudit(owner.name, "join-code.revoked", before.id, before, row);
  res.json(codeOut(row!));
});

// Platform owner edits the contact on file (email, phone, name). The email is
// what job requests from the Join page are locked to.
router.patch("/v1/platform/join-requests/:id", requirePlatformOwner, async (req, res) => {
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const owner = res.locals["platformOwner"] as { name: string };
  const [before] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params.id || "")), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false))).limit(1);
  if (!before) { res.status(404).json({ error: "Request not found" }); return; }
  const patch: Record<string, string> = {};
  if (typeof b["email"] === "string") { const email = str(b["email"], 200).toLowerCase(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email" }); return; } patch["email"] = email; }
  if (typeof b["phone"] === "string") patch["phone"] = str(b["phone"], 60);
  if (typeof b["contactName"] === "string") patch["contactName"] = str(b["contactName"], 200);
  const now = new Date();
  const [row] = await db.update(entityRecords).set({ state: { ...before.state, ...patch, contactUpdatedAt: now.toISOString(), contactUpdatedBy: owner.name }, updatedAt: now }).where(eq(entityRecords.id, before.id)).returning();
  await platformAudit(owner.name, "join-request.contact-updated", before.id, before, row);
  res.json({ ok: true, ...patch });
});

router.post("/v1/platform/join-requests/:id/:decision", async (req, res) => {
  const decision = String(req.params.decision || "");
  if (!["approve", "decline"].includes(decision)) { res.status(404).json({ error: "Not found" }); return; }
  const [before] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params.id || "")), eq(entityRecords.entity, ENTITY))).limit(1);
  if (!before) { res.status(404).json({ error: "Request not found" }); return; }
  const owner = res.locals["platformOwner"] as { name: string };
  const now = new Date();
  const status = decision === "approve" ? "approved" : "declined";
  // The code is made here, at approval, by Platform Control.
  const accessCode = status === "approved" ? (String(before.state["accessCode"] || "") || newAccessCode()) : String(before.state["accessCode"] || "");
  const [row] = await db.update(entityRecords).set({
    state: { ...before.state, status, accessCode, decidedAt: now.toISOString(), decidedBy: owner.name },
    updatedAt: now,
  }).where(eq(entityRecords.id, before.id)).returning();
  await platformAudit(owner.name, `join-request.${status}`, before.id, before, row);
  let emailed = false;
  const email = String(before.state["email"] || "");
  if (status === "approved" && email) {
    emailed = await sendMail(email, "FIAREP: your pilot request is approved", [
      `<p>Hello ${esc(before.state["contactName"])},</p>`,
      `<p>FIAREP approved the pilot request for <strong>${esc(before.state["company"])}</strong>.</p>`,
      `<p>Your access code is <strong style="font-size:20px">${esc(accessCode)}</strong>. Open <a href="${SITE}/join">${SITE}/join</a>, scroll to the Violation resolution estimator and enter the code to unlock it.</p>`,
      `<p>We will call you at ${esc(before.state["phone"] || email)} to set up the pilot.</p>`,
    ].join(""));
  }
  res.json({ ok: true, status, accessCode, emailed });
});

// Platform owner: email a built service agreement to the client from the
// FIAREP mailbox. The HTML comes from the browser (lib/contract.ts); what was
// sent is kept as a "contracts" record.
router.post("/v1/platform/contracts/email", requirePlatformOwner, async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const to = str(body["to"]);
  const html = String(body["html"] ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { res.status(400).json({ error: "A valid client email is required." }); return; }
  if (!html.includes("Service Agreement") || html.length > 400_000) { res.status(400).json({ error: "Contract body missing or too large." }); return; }
  const subject = str(body["subject"]) || "FIAREP Service Agreement";
  const owner = res.locals["platformOwner"] as { name: string };
  const emailed = await sendMail(to, subject, html);
  const now = new Date();
  const [row] = await db.insert(entityRecords).values({
    id: randomUUID(), tenantId: "default", entity: "contracts", development: str(body["company"]) || null,
    state: { number: str(body["number"]), company: str(body["company"]), kind: str(body["kind"]), monthly: Number(body["monthly"]) || 0, scopeTotal: Number(body["scopeTotal"]) || 0, to, emailed, sentAt: now.toISOString(), sentBy: owner.name },
    createdBy: "platform-owner", createdAt: now, updatedAt: now,
  }).returning();
  await platformAudit(owner.name, "contract.emailed", row!.id, null, row);
  res.json({ ok: true, emailed });
});

export default router;
