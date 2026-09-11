import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import {
  db,
  deviceTokens,
  pushDeliveries,
  staffAccounts,
} from "@workspace/db";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;

type PushNotification = {
  id: string;
  tenantId: string;
  target: string;
  message: string;
  detail?: string | null;
  reportId?: string | null;
};

type Recipient = {
  tokenId: string;
  token: string;
  staffId: string;
};

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function recipientsFor(
  notification: PushNotification,
): Promise<Recipient[]> {
  return db
    .select({
      tokenId: deviceTokens.id,
      token: deviceTokens.token,
      staffId: staffAccounts.id,
    })
    .from(deviceTokens)
    .innerJoin(
      staffAccounts,
      and(
        eq(staffAccounts.tenantId, deviceTokens.tenantId),
        eq(staffAccounts.id, deviceTokens.staffId),
      ),
    )
    .where(
      and(
        eq(deviceTokens.tenantId, notification.tenantId),
        eq(staffAccounts.status, "approved"),
        or(
          eq(staffAccounts.name, notification.target),
          eq(staffAccounts.role, notification.target),
        ),
      ),
    );
}

async function recordDelivery(
  notification: PushNotification,
  recipient: Recipient | undefined,
  status: string,
  ticket?: ExpoTicket,
) {
  await db.insert(pushDeliveries).values({
    id: randomUUID(),
    tenantId: notification.tenantId,
    notificationId: notification.id,
    tokenId: recipient?.tokenId,
    staffId: recipient?.staffId,
    status,
    ticketId: ticket?.id,
    errorCode: ticket?.details?.error,
    detail: ticket?.message,
  });
}

async function removeInvalidToken(recipient: Recipient, ticket: ExpoTicket) {
  if (ticket.details?.error !== "DeviceNotRegistered") return;
  await db
    .delete(deviceTokens)
    .where(
      and(
        eq(deviceTokens.id, recipient.tokenId),
        eq(deviceTokens.token, recipient.token),
      ),
    );
}

export async function deliverPushNotification(
  notification: PushNotification,
): Promise<void> {
  const recipients = await recipientsFor(notification);
  if (recipients.length === 0) {
    await recordDelivery(notification, undefined, "no_recipients");
    return;
  }

  for (const batch of chunks(recipients, EXPO_BATCH_SIZE)) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          batch.map((recipient) => ({
            to: recipient.token,
            title: "FIAREP.COM",
            body: notification.message,
            data: {
              notificationId: notification.id,
              reportId: notification.reportId ?? null,
              detail: notification.detail ?? null,
            },
            sound: "default",
          })),
        ),
      });

      if (!response.ok) {
        throw new Error(`Expo push request failed with HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = Array.isArray(payload.data) ? payload.data : [];

      await Promise.all(
        batch.map(async (recipient, index) => {
          const ticket = tickets[index] ?? {
            status: "error",
            message: "Expo did not return a ticket",
            details: { error: "MissingTicket" },
          };
          await recordDelivery(
            notification,
            recipient,
            ticket.status === "ok" ? "accepted" : "rejected",
            ticket,
          );
          await removeInvalidToken(recipient, ticket);
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await Promise.all(
        batch.map((recipient) =>
          recordDelivery(notification, recipient, "request_failed", {
            message: detail,
            details: { error: "ExpoRequestFailed" },
          }),
        ),
      );
      logger.error(
        { err: error, notificationId: notification.id },
        "Expo push delivery failed",
      );
    }
  }
}