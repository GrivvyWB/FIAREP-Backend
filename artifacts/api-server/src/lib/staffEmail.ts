import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

/** Leave that needs HR: over the management allotment, or sent up by the
 * supervisor. Goes to the organization's HR mailbox. */
export async function emailHrLeaveRequest(input: {
  hrEmail: string;
  employee: string;
  title?: string;
  development?: string;
  startAt: string;
  endAt: string;
  days: number;
  reason?: string;
  sentBy?: string;
  note?: string;
}): Promise<boolean> {
  const email = String(input.hrEmail || "").trim();
  if (!email.includes("@")) return false;
  const why = input.sentBy
    ? `${escapeHtml(input.sentBy)} sent this leave request to HR${input.note ? `: ${escapeHtml(input.note)}` : "."}`
    : `This request is for ${input.days} days — over the 30 days management may decide, so it needs HR.`;
  const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: `FIAREP leave request needs HR — ${input.employee} (${input.days} days)`,
        body: {
          contentType: "HTML",
          content: [
            `<p>${why}</p>`,
            `<p><strong>Employee:</strong> ${escapeHtml(input.employee)}${input.title ? ` (${escapeHtml(input.title)})` : ""}${input.development ? ` · ${escapeHtml(input.development)}` : ""}<br>`,
            `<strong>Dates:</strong> ${escapeHtml(input.startAt.slice(0, 10))} to ${escapeHtml(input.endAt.slice(0, 10))} (${input.days} days)`,
            input.reason ? `<br><strong>Reason:</strong> ${escapeHtml(input.reason)}` : "",
            `</p>`,
            `<p>Open <strong>Pending Leave</strong> on fiarep.com as HR, check with the supervisor, then approve or deny.</p>`,
          ].join(""),
        },
        toRecipients: [{ emailAddress: { address: email } }],
      },
      saveToSentItems: true,
    }),
  });
  return response.status === 202;
}

export async function emailStaffAccessCode(input: {
  email: string;
  employeeName: string;
  code: string;
}): Promise<void> {
  const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: "Your FIAREP sign-in code",
        body: {
          contentType: "HTML",
          content: [
            `<p>Hello ${escapeHtml(input.employeeName)},</p>`,
            "<p>Your FIAREP sign-in code is:</p>",
            `<p style="font-size:24px;font-weight:700;letter-spacing:0.25em">${escapeHtml(input.code)}</p>`,
            "<p>If you forget this code, contact Human Resources for a replacement.</p>",
          ].join(""),
        },
        toRecipients: [{
          emailAddress: {
            address: input.email,
            name: input.employeeName,
          },
        }],
      },
      saveToSentItems: true,
    }),
  });
  if (response.status !== 202) {
    throw new Error("The employee code email could not be sent");
  }
}