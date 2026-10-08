// Job requests from the Join page: an approved client looks up a building,
// confirms the open-violation counts, and submits it to FIAREP. Saved for
// Platform Control, emailed to the FIAREP inbox. The owner accepts or declines;
// the repair quote comes later from the price book / contract.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, desc, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { rateLimit } from "../lib/rateLimit";
import { requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";

const connectors = new ReplitConnectors();
const INBOX = process.env["JOIN_REQUEST_EMAIL"] || "fiarep@outlook.com";
const SITE = (process.env["PUBLIC_WEB_URL"] || "https://fiarep.com").replace(/\/$/, "");
const ENTITY = "work-requests";
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const int = (v: unknown) => Math.max(0, Math.min(100_000, Math.round(Number(v) || 0)));
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }),
    });
    return response.ok;
  } catch { return false; }
}

const router: IRouter = Router();
router.use("/v1/public/work-requests", rateLimit("work-requests", 20));

router.post("/v1/public/work-requests", async (req, res) => {
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const company = str(b["company"], 200);
  const contact = str(b["contact"], 200);
  const phone = str(b["phone"], 60);
  const address = str(b["address"], 300);
  // Always delivered to the FIAREP inbox. The client's reply email is never typed on
  // the site: it is the one on their approved join request (set in Platform Control).
  const joinId = str(b["joinId"], 80);
  const [join] = joinId ? await db.select().from(entityRecords).where(and(eq(entityRecords.id, joinId), eq(entityRecords.entity, "join-requests"), eq(entityRecords.deleted, false))).limit(1) : [];
  const typed = str(b["email"], 200).toLowerCase();
  const onFile = join && String(join.state["status"] || "") === "approved" ? String(join.state["email"] || "").toLowerCase() : "";
  const email = typed || onFile;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email." }); return; }
  if (!company || !contact || !address || (!email && !phone)) { res.status(400).json({ error: "Company, your name, the building address, and an email or phone number are required." }); return; }
  const now = new Date();
  const id = randomUUID();
  const state = {
    status: "new", createdAt: now.toISOString(),
    joinId, company, contact, email, phone, address,
    borough: str(b["borough"], 40), block: str(b["block"], 10), lot: str(b["lot"], 10), bbl: str(b["bbl"], 12), bin: str(b["bin"], 10),
    units: int(b["units"]), apartments: int(b["apartments"]), hpdA: int(b["hpdA"]), hpdB: int(b["hpdB"]), hpdC: int(b["hpdC"]), dob: int(b["dob"]),
    dofOwed: Number(b["dofOwed"]) || 0, notes: str(b["notes"], 2000),
    quotedExpediter: Number(b["quotedExpediter"]) || 0, quotedRepairs: Number(b["quotedRepairs"]) || 0,
    hpdTypes: (Array.isArray(b["hpdTypes"]) ? b["hpdTypes"] : []).slice(0, 40).map((t) => { const x = (t && typeof t === "object" ? t : {}) as Record<string, unknown>; return { type: str(x["type"], 60), count: int(x["count"]), a: int(x["a"]), b: int(x["b"]), c: int(x["c"]), jobs: int(x["jobs"]) }; }).filter((t) => t.type),
    dobTypes: (Array.isArray(b["dobTypes"]) ? b["dobTypes"] : []).slice(0, 40).map((t) => { const x = (t && typeof t === "object" ? t : {}) as Record<string, unknown>; return { type: str(x["type"], 80), count: int(x["count"]) }; }).filter((t) => t.type),
  };
  await db.insert(entityRecords).values({ id, tenantId: "default", entity: ENTITY, development: company, state, createdBy: "public-join", createdAt: now, updatedAt: now });
  const emailed = await sendMail(INBOX, `Job request: ${address} — ${company} (${state.hpdA + state.hpdB + state.hpdC} HPD · ${state.dob} DOB)`, [
    `<h2>${esc(company)} submitted a building</h2>`,
    `<p><strong>${esc(address)}</strong><br>${esc(state.borough)} · Block ${esc(state.block)} · Lot ${esc(state.lot)} · BBL ${esc(state.bbl)} · BIN ${esc(state.bin)} · ${state.units} units</p>`,
    `<table border="1" cellpadding="6" cellspacing="0"><tr><th>HPD A</th><th>HPD B</th><th>HPD C</th><th>Apartments cited</th><th>DOB</th><th>Owed to the City</th></tr><tr><td>${state.hpdA}</td><td>${state.hpdB}</td><td>${state.hpdC}</td><td>${state.apartments}</td><td>${state.dob}</td><td>${money(state.dofOwed)}</td></tr></table>`,
    `<p><strong>Client saw on the site:</strong> expediting ${money(state.quotedExpediter)} · repairs est. ${money(state.quotedRepairs)}</p>`,
    state.hpdTypes.length ? `<p><strong>What they are:</strong> ${state.hpdTypes.map((t) => `${esc(t.type)} ${t.count}`).join(" · ")}${state.dobTypes.length ? ` · DOB: ${state.dobTypes.map((t) => `${esc(t.type)} ${t.count}`).join(", ")}` : ""}</p>` : "",
    `<p><strong>Contact:</strong> ${esc(contact)} · ${esc(phone)} · ${esc(email)}</p>`,
    state.notes ? `<p><strong>Notes:</strong><br>${esc(state.notes).replaceAll("\n", "<br>")}</p>` : "",
    `<p>Accept it in Platform Control → Job requests: <a href="${SITE}/platform-owner/work-requests">${SITE}/platform-owner/work-requests</a></p>`,
    `<p style="color:#666;font-size:12px">Request ${id} · ${now.toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>`,
  ].join(""));
  res.status(201).json({ ok: true, id, status: "new", emailed });
});

// The client's browser checks the status of what it submitted.
router.get("/v1/public/work-requests/:id", async (req, res) => {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params["id"])), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: row.id, status: String(row.state["status"] || "new"), address: String(row.state["address"] || ""), decidedAt: row.state["decidedAt"] || null, message: String(row.state["message"] || ""), quotedTotal: Number(row.state["quotedTotal"]) || 0, quotedAt: row.state["quotedAt"] || null });
});

router.use("/v1/platform/work-requests", requirePlatformOwner);
router.get("/v1/platform/work-requests", async (_req, res) => {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false))).orderBy(desc(entityRecords.createdAt)).limit(500);
  res.json(rows.map((r) => ({ id: r.id, ...r.state })));
});

router.post("/v1/platform/work-requests/:id/:decision", async (req, res) => {
  const decision = String(req.params["decision"]);
  if (decision !== "accept" && decision !== "decline") { res.status(400).json({ error: "accept or decline" }); return; }
  const message = str((req.body as Record<string, unknown> | undefined)?.["message"], 2000);
  const owner = res.locals["platformOwner"] as { name: string };
  const [before] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params["id"])), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false))).limit(1);
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  const status = decision === "accept" ? "accepted" : "declined";
  const now = new Date();
  const state = { ...before.state, status, message, decidedAt: now.toISOString(), decidedBy: owner.name };
  const [row] = await db.update(entityRecords).set({ state, updatedAt: now }).where(eq(entityRecords.id, before.id)).returning();
  await platformAudit(owner.name, `work-request.${status}`, before.id, before, row);
  const email = String(state["email"] || "");
  let emailed = false;
  if (email) {
    emailed = await sendMail(email, `FIAREP: ${String(state["address"])} — ${status}`, [
      `<p>${esc(state["contact"])},</p>`,
      status === "accepted"
        ? `<p>FIAREP accepted <strong>${esc(state["address"])}</strong> for violation work: ${state["hpdA"]} HPD Class A, ${state["hpdB"]} Class B, ${state["hpdC"]} Class C, ${state["dob"]} DOB. We start on the violations under your plan; the repair quote for any physical work follows separately.</p>`
        : `<p>FIAREP is not able to take <strong>${esc(state["address"])}</strong> at this time.</p>`,
      message ? `<p>${esc(message).replaceAll("\n", "<br>")}</p>` : "",
      `<p>FIAREP · <a href="${SITE}">${SITE}</a></p>`,
    ].join(""));
  }
  res.json({ ok: true, status, emailed });
});

export default router;
