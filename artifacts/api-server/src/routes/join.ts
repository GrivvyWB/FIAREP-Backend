// "Join FIAREP": a management company, owner or agency asks to pilot the
// service. Saved for the platform owner and emailed to FIAREP.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, entityRecords } from "@workspace/db";
import { rateLimit } from "../lib/rateLimit";

const connectors = new ReplitConnectors();
const JOIN_INBOX = process.env["JOIN_REQUEST_EMAIL"] || "fiarep@outlook.com";
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

type Development = { name: string; address: string; units: string };

const router: IRouter = Router();
router.use("/v1/public/join-requests", rateLimit("join-requests", 10));

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
    id, tenantId: "default", entity: "join-requests", development: company, state,
    createdBy: "public-join", createdAt: now, updatedAt: now,
  });
  // Email FIAREP. The request is saved either way.
  let emailed = false;
  try {
    const rows = developments.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.name)}</td><td>${esc(d.address)}</td><td>${esc(d.units)}</td></tr>`).join("");
    const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `Join FIAREP: ${company} (${developments.length} development${developments.length === 1 ? "" : "s"})`,
          body: {
            contentType: "HTML",
            content: [
              `<h2>${esc(company)} wants to pilot FIAREP</h2>`,
              `<p><strong>Contact:</strong> ${esc(contactName)}<br><strong>Phone:</strong> ${esc(phone)}<br><strong>Email:</strong> ${esc(email)}<br><strong>Office:</strong> ${esc(address)}</p>`,
              `<p><strong>Portfolio size:</strong> ${esc(portfolioSize)}</p>`,
              rows ? `<table border="1" cellpadding="6" cellspacing="0"><tr><th>#</th><th>Development</th><th>Address</th><th>Units</th></tr>${rows}</table>` : "<p>No developments listed.</p>",
              services.length ? `<p><strong>Services wanted:</strong> ${services.map(esc).join(", ")}</p>` : "",
              notes ? `<p><strong>Notes:</strong><br>${esc(notes).replaceAll("\n", "<br>")}</p>` : "",
              `<p style="color:#666;font-size:12px">Request ${id} · ${now.toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>`,
            ].join(""),
          },
          toRecipients: [{ emailAddress: { address: JOIN_INBOX } }],
        },
        saveToSentItems: true,
      }),
    });
    emailed = response.ok;
  } catch { emailed = false; }
  res.status(201).json({ ok: true, id, emailed });
});

export default router;
