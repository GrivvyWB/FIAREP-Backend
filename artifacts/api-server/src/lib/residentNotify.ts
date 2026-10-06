// Telling the resident what happened to their complaint.
//
// A resident has no login. The app registers the phone's push token on the
// complaint when it is filed (state.residentPush); the website asks for an
// email (state.reporterEmail). Every step — opened, assigned, on the way,
// work started, work done — goes to whichever of those the complaint has.
import { ReplitConnectors } from "@replit/connectors-sdk";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const connectors = new ReplitConnectors();

type Row = { id: string; tenantId: string; entity: string; state: Record<string, unknown> };

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function residentPushTokenOf(state: Record<string, unknown>): string {
  const push = state["residentPush"];
  const token = push && typeof push === "object" ? String((push as Record<string, unknown>)["token"] || "") : "";
  return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token) ? token : "";
}

export function residentEmailOf(state: Record<string, unknown>): string {
  const email = String(state["reporterEmail"] || state["email"] || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/** What to tell the resident for a workflow action, or null if it's internal. */
export function residentMessageForAction(action: string, state: Record<string, unknown>, actorName: string): { title: string; body: string } | null {
  const who = String(state["assignedTo"] || "").trim();
  switch (action) {
    case "assign":
      return { title: "Assigned", body: who ? `Your complaint was assigned to ${who}.` : "Your complaint was assigned to a crew member." };
    case "start":
      return { title: "Work started", body: `${actorName || "The crew"} started work on your complaint.` };
    case "complete":
    case "resolve":
    case "clear": {
      const note = String(state["completionNote"] || "").trim();
      return { title: "Work completed", body: `Work on your complaint is done.${note ? ` ${note}` : ""} Open Check Report Status to see the details.` };
    }
    default:
      return null;
  }
}

async function pushTo(token: string, ref: string, title: string, body: string, reportId: string): Promise<void> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify([{ to: token, title: `${ref} · ${title}`, body, sound: "default", data: { kind: "resident", complaintNo: ref, reportId } }]),
  });
  if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
}

async function emailTo(email: string, ref: string, title: string, body: string): Promise<void> {
  const link = `${(process.env["PUBLIC_WEB_URL"] || "https://fiarep.com").replace(/\/$/, "")}/resident`;
  const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: `Complaint ${ref}: ${title}`,
        body: {
          contentType: "HTML",
          content: [
            `<p>${escapeHtml(body)}</p>`,
            `<p><strong>Complaint number:</strong> ${escapeHtml(ref)}</p>`,
            `<p>To see the full history, go to <a href="${link}">${link}</a>, choose Check Report Status and enter your complaint number.</p>`,
            `<p style="color:#666;font-size:12px">Sent by FIAREP on behalf of your management office. Replies to this email are not read.</p>`,
          ].join(""),
        },
        toRecipients: [{ emailAddress: { address: email } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!response.ok) throw new Error(`Outlook sendMail HTTP ${response.status}`);
}

/** Push to the resident's phone and/or email them. Never throws. */
export async function notifyResident(row: Row, title: string, body: string): Promise<void> {
  if (row.entity !== "resident-reports") return;
  const ref = String(row.state["complaintNo"] || "your complaint");
  const token = residentPushTokenOf(row.state);
  const email = residentEmailOf(row.state);
  if (token) await pushTo(token, ref, title, body, row.id).catch(() => undefined);
  if (email) await emailTo(email, ref, title, body).catch(() => undefined);
}
