import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";

const connectors = new ReplitConnectors();
const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export async function emailReleasedScope(
  tenantId: string,
  scope: Record<string, unknown>,
  suppliedRecipients: Array<{ name: string; email: string }> = [],
  includeContacts = true,
): Promise<{ sent: number; failed: number; recipients: number }> {
  const contacts = !includeContacts ? [] : await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, tenantId),
    eq(entityRecords.entity, "vendor-contacts"),
    eq(entityRecords.deleted, false),
  ));
  const recipients = new Map<string, string>();
  for (const contact of contacts) {
    const email = String(contact.state["email"] ?? "").trim().toLowerCase();
    const name = String(contact.state["name"] ?? "").trim();
    if (email && email.includes("@")) recipients.set(email, name);
  }
  for (const contact of suppliedRecipients) {
    const email = String(contact.email ?? "").trim().toLowerCase();
    const name = String(contact.name ?? "").trim();
    if (email && email.includes("@")) recipients.set(email, name);
  }
  const trackingId = String(scope["trackingId"] ?? "").trim();
  const address = String(scope["address"] ?? "").trim();
  // The complaint / violation number this job came from.
  const reference = String(scope["sourceRef"] ?? scope["complaintNo"] ?? scope["violationNo"] ?? "").trim();
  const work = String(scope["scope"] ?? "").trim();
  const walkthrough = String(scope["walkthroughAt"] ?? "").trim();
  const bidClose = String(scope["bidCloseAt"] ?? "").trim();
  const walkNote = String(scope["walkthroughNote"] ?? "").trim();
  const code = String(scope["violationCode"] ?? "").trim();
  const hazard = String(scope["hazardClass"] ?? "").trim();
  const codeDesc = String(scope["violationCodeDesc"] ?? "").trim();
  const sections: string[] = [];
  const snapshot = scope["vendorScopeTemplate"] as { divisions?: Array<{ sections?: Array<{ code?: string }> }> } | undefined;
  for (const division of snapshot?.divisions ?? []) {
    for (const section of division.sections ?? []) if (section.code) sections.push(String(section.code));
  }
  const vendorLink = `${(process.env["PUBLIC_WEB_URL"] || "https://fiarep.com").replace(/\/$/, "")}/vendor`;
  let sent = 0;
  let failed = 0;
  for (const [email, name] of recipients) {
    const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `FIAREP scope of work ${trackingId}${reference ? ` · ${reference}` : ""}`,
          body: {
            contentType: "HTML",
            content: [
              `<p>Hello ${escapeHtml(name || "Vendor")},</p>`,
              "<p>FIAREP Procurement released a scope of work for bidding.</p>",
              `<p><strong>Code:</strong> ${escapeHtml(trackingId)}<br>`,
              reference ? `<strong>Reference:</strong> ${escapeHtml(reference)}<br>` : "",
              `<strong>Address:</strong> ${escapeHtml(address)}</p>`,
              code ? `<p><strong>Violation code:</strong> ${escapeHtml(code)}${hazard ? ` · Class ${escapeHtml(hazard)}` : ""}${codeDesc ? ` — ${escapeHtml(codeDesc)}` : ""}</p>` : "",
              sections.length ? `<p><strong>Type of work:</strong><br>${sections.map(escapeHtml).join("<br>")}</p>` : "",
              `<p><strong>Scope of work</strong><br>${escapeHtml(work).replaceAll("\n", "<br>")}</p>`,
              walkthrough ? `<p><strong>Walk-through:</strong> ${escapeHtml(walkthrough)}${walkNote ? `<br>${escapeHtml(walkNote)}` : ""}</p>` : "",
              bidClose ? `<p><strong>Bids close:</strong> ${escapeHtml(bidClose)}</p>` : "",
              `<p>Go to <a href="${vendorLink}">${vendorLink}</a> (or open the FIAREP app and select Vendor), enter your company name and the code ${escapeHtml(trackingId)} to see the full scope, check in at the walk-through and submit your price.</p>`,
            ].join(""),
          },
          toRecipients: [{ emailAddress: { address: email, name: name || undefined } }],
        },
        saveToSentItems: true,
      }),
    });
    if (response.status === 202) sent += 1;
    else failed += 1;
  }
  return { sent, failed, recipients: recipients.size };
}

// The award: tell the winning vendor (contact email on file) that the job is
// theirs and where to start it. Bids carry no email, so the vendor-contacts
// list is the address book; without a match nothing is sent (the vendor's
// page and app still show "Awarded to you").
export async function emailAwardedVendor(
  tenantId: string,
  scope: Record<string, unknown>,
): Promise<{ sent: boolean; email?: string; reason?: string }> {
  const vendor = String(scope["vendor"] ?? "").trim().toLowerCase();
  if (!vendor) return { sent: false, reason: "no vendor" };
  const contacts = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, tenantId),
    eq(entityRecords.entity, "vendor-contacts"),
    eq(entityRecords.deleted, false),
  ));
  const contact = contacts.find((c) => String(c.state["name"] ?? "").trim().toLowerCase() === vendor);
  const email = String(contact?.state["email"] ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { sent: false, reason: "no contact email for " + vendor };
  const trackingId = String(scope["trackingId"] ?? "").trim();
  const address = String(scope["address"] ?? "").trim();
  const reference = String(scope["sourceRef"] ?? scope["complaintNo"] ?? scope["violationNo"] ?? "").trim();
  const amount = Number(scope["bidAmount"] ?? 0) || 0;
  const vendorLink = `${(process.env["PUBLIC_WEB_URL"] || "https://fiarep.com").replace(/\/$/, "")}/vendor`;
  const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: `FIAREP — you were awarded ${trackingId}${reference ? ` · ${reference}` : ""}`,
        body: {
          contentType: "HTML",
          content: [
            `<p>Hello ${escapeHtml(String(contact?.state["name"] ?? "") || "Vendor")},</p>`,
            `<p><strong>Congratulations — FIAREP Procurement awarded you this job.</strong></p>`,
            `<p><strong>Code:</strong> ${escapeHtml(trackingId)}<br>`,
            reference ? `<strong>Reference:</strong> ${escapeHtml(reference)}<br>` : "",
            `<strong>Address:</strong> ${escapeHtml(address)}`,
            amount ? `<br><strong>Your bid:</strong> $${amount.toFixed(2)}` : "",
            `</p>`,
            `<p>Go to <a href="${vendorLink}">${vendorLink}</a> (or open the FIAREP app and select Vendor), enter your company name and the code ${escapeHtml(trackingId)}, then tap <strong>Start work</strong> when you begin. Extra work found on site goes in as a change work order from the same page.</p>`,
          ].join(""),
        },
        toRecipients: [{ emailAddress: { address: email, name: String(contact?.state["name"] ?? "") || undefined } }],
      },
      saveToSentItems: true,
    }),
  });
  return { sent: response.status === 202, email };
}

// Tell the vendor what happened to their change work order (received /
// approved by the supervisor / cost approved by Procurement / declined).
// Sent to the vendor's contact email when one is on file; the vendor's page
// and app show the same status either way.
export async function emailVendorChangeOrderStatus(
  tenantId: string,
  changeOrder: Record<string, unknown>,
): Promise<boolean> {
  const vendor = String(changeOrder["vendor"] ?? "").trim().toLowerCase();
  if (!vendor) return false;
  const contacts = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, tenantId),
    eq(entityRecords.entity, "vendor-contacts"),
    eq(entityRecords.deleted, false),
  ));
  const contact = contacts.find((c) => String(c.state["name"] ?? "").trim().toLowerCase() === vendor);
  const email = String(contact?.state["email"] ?? "").trim().toLowerCase();
  if (!email.includes("@")) return false;
  const status = String(changeOrder["status"] ?? "");
  const headline =
    status === "cost_approved" ? "APPROVED — go ahead with the extra work" :
    status === "mgmt_approved" ? "Approved by the supervisor — with Procurement for cost approval" :
    status === "declined" ? "Declined" : "Received — awaiting supervisor review";
  const ref = String(changeOrder["reportRef"] ?? "").trim();
  const by = String(changeOrder["respondedByName"] ?? "").trim();
  const reason = String(changeOrder["reason"] ?? "").trim();
  const cost = Number(changeOrder["cost"] ?? 0) || 0;
  const vendorLink = `${(process.env["PUBLIC_WEB_URL"] || "https://fiarep.com").replace(/\/$/, "")}/vendor`;
  try {
    const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `FIAREP change work order ${headline.split(" — ")[0]}${ref ? ` · ${ref}` : ""}`,
          body: {
            contentType: "HTML",
            content: `<p><strong>${escapeHtml(headline)}</strong>${by ? ` by ${escapeHtml(by)}` : ""}</p>` +
              (ref ? `<p>Job: ${escapeHtml(ref)}</p>` : "") +
              `<p>What changed: ${escapeHtml(changeOrder["description"])}</p>` +
              `<p>Why: ${escapeHtml(changeOrder["vendorReason"])}</p>` +
              `<p>Measurements: ${escapeHtml(changeOrder["measurements"])}</p>` +
              (cost ? `<p>Added cost: $${cost.toFixed(2)}</p>` : "") +
              (status === "declined" && reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : "") +
              `<p>Open your job at <a href="${vendorLink}">${vendorLink}</a> with your tracking ID to see it.</p>`,
          },
          toRecipients: [{ emailAddress: { address: email, name: String(contact?.state["name"] ?? "") || undefined } }],
        },
        saveToSentItems: true,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
