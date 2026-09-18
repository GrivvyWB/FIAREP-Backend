import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

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