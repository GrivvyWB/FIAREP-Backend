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
): Promise<{ sent: number; failed: number }> {
  const contacts = await db.select().from(entityRecords).where(and(
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
  const work = String(scope["scope"] ?? "").trim();
  const walkthrough = String(scope["walkthroughAt"] ?? "").trim();
  const bidClose = String(scope["bidCloseAt"] ?? "").trim();
  let sent = 0;
  let failed = 0;
  for (const [email, name] of recipients) {
    const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `FIAREP scope of work ${trackingId}`,
          body: {
            contentType: "HTML",
            content: [
              `<p>Hello ${escapeHtml(name || "Vendor")},</p>`,
              "<p>FIAREP Procurement released a scope of work for bidding.</p>",
              `<p><strong>Code:</strong> ${escapeHtml(trackingId)}<br>`,
              `<strong>Address:</strong> ${escapeHtml(address)}</p>`,
              `<p><strong>Scope of work</strong><br>${escapeHtml(work).replaceAll("\n", "<br>")}</p>`,
              walkthrough ? `<p><strong>Walkthrough:</strong> ${escapeHtml(walkthrough)}</p>` : "",
              bidClose ? `<p><strong>Bids close:</strong> ${escapeHtml(bidClose)}</p>` : "",
              "<p>Open FIAREP, select Vendor, then enter your vendor name and this code to review the scope and submit pricing.</p>",
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
  return { sent, failed };
}