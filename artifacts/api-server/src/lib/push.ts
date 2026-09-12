import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  lt,
  lte,
  or,
} from "drizzle-orm";
import {
  db,
  deviceTokens,
  pushDeliveries,
  staffAccounts,
} from "@workspace/db";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_BATCH_SIZE = 100;
const RECEIPT_BATCH_SIZE = 300;
const RECEIPT_INITIAL_DELAY_MS = 15 * 60_000;
const RECEIPT_POLL_INTERVAL_MS = 30_000;
const RECEIPT_MAX_ATTEMPTS = 8;
const RECEIPT_MAX_DELAY_MS = 6 * 60 * 60_000;
const RECEIPT_CLAIM_TIMEOUT_MS = 2 * 60_000;
const EXPO_REQUEST_TIMEOUT_MS = 15_000;

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

type ExpoReceipt = ExpoTicket & {
  details?: { error?: string };
};

type PendingDelivery = {
  id: string;
  ticketId: string | null;
  tokenId: string | null;
  receiptAttempts: number;
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
          eq(staffAccounts.id, notification.target),
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
    nextReceiptCheckAt:
      status === "accepted" && ticket?.id
        ? new Date(Date.now() + RECEIPT_INITIAL_DELAY_MS)
        : undefined,
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
        signal: AbortSignal.timeout(EXPO_REQUEST_TIMEOUT_MS),
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

function receiptRetryDelay(attempt: number): number {
  return Math.min(
    RECEIPT_INITIAL_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    RECEIPT_MAX_DELAY_MS,
  );
}

async function retryReceipt(
  delivery: PendingDelivery,
  detail: string,
): Promise<void> {
  const attempts = delivery.receiptAttempts + 1;
  const exhausted = attempts >= RECEIPT_MAX_ATTEMPTS;
  await db
    .update(pushDeliveries)
    .set({
      receiptAttempts: attempts,
      status: exhausted ? "receipt_timeout" : "accepted",
      detail,
      errorCode: exhausted ? "ReceiptTimeout" : null,
      nextReceiptCheckAt: exhausted
        ? null
        : new Date(Date.now() + receiptRetryDelay(attempts)),
      completedAt: exhausted ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pushDeliveries.id, delivery.id),
        eq(pushDeliveries.status, "receipt_checking"),
      ),
    );
}

async function finishReceipt(
  delivery: PendingDelivery,
  receipt: ExpoReceipt,
): Promise<void> {
  const delivered = receipt.status === "ok";
  await db
    .update(pushDeliveries)
    .set({
      receiptAttempts: delivery.receiptAttempts + 1,
      status: delivered ? "delivered" : "failed",
      detail: receipt.message ?? null,
      errorCode: receipt.details?.error ?? null,
      nextReceiptCheckAt: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pushDeliveries.id, delivery.id),
        eq(pushDeliveries.status, "receipt_checking"),
      ),
    );

  if (
    receipt.details?.error === "DeviceNotRegistered" &&
    delivery.tokenId
  ) {
    await db
      .delete(deviceTokens)
      .where(eq(deviceTokens.id, delivery.tokenId));
  }
}

export async function pollPushReceipts(): Promise<number> {
  const now = new Date();
  await db
    .update(pushDeliveries)
    .set({
      status: "accepted",
      nextReceiptCheckAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(pushDeliveries.status, "receipt_checking"),
        lt(
          pushDeliveries.updatedAt,
          new Date(now.getTime() - RECEIPT_CLAIM_TIMEOUT_MS),
        ),
      ),
    );

  const candidates = await db
    .select({
      id: pushDeliveries.id,
    })
    .from(pushDeliveries)
    .where(
      and(
        eq(pushDeliveries.status, "accepted"),
        lte(pushDeliveries.nextReceiptCheckAt, new Date()),
      ),
    )
    .orderBy(asc(pushDeliveries.nextReceiptCheckAt))
    .limit(RECEIPT_BATCH_SIZE);

  if (candidates.length === 0) return 0;
  const pending = await db
    .update(pushDeliveries)
    .set({ status: "receipt_checking", updatedAt: now })
    .where(
      and(
        inArray(
          pushDeliveries.id,
          candidates.map((candidate) => candidate.id),
        ),
        eq(pushDeliveries.status, "accepted"),
        lte(pushDeliveries.nextReceiptCheckAt, now),
      ),
    )
    .returning({
      id: pushDeliveries.id,
      ticketId: pushDeliveries.ticketId,
      tokenId: pushDeliveries.tokenId,
      receiptAttempts: pushDeliveries.receiptAttempts,
    });

  if (pending.length === 0) return 0;
  const withTickets = pending.filter(
    (delivery): delivery is PendingDelivery & { ticketId: string } =>
      Boolean(delivery.ticketId),
  );

  try {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      signal: AbortSignal.timeout(EXPO_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: withTickets.map((delivery) => delivery.ticketId),
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Expo receipt request failed with HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as {
      data?: Record<string, ExpoReceipt>;
    };
    const receipts = payload.data ?? {};
    await Promise.all(
      pending.map((delivery) => {
        if (!delivery.ticketId) {
          return retryReceipt(delivery, "Accepted delivery has no ticket ID");
        }
        const receipt = receipts[delivery.ticketId];
        return receipt
          ? finishReceipt(delivery, receipt)
          : retryReceipt(delivery, "Expo receipt is not ready");
      }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await Promise.all(
      pending.map((delivery) => retryReceipt(delivery, detail)),
    );
    logger.error({ err: error }, "Expo receipt polling failed");
  }

  return pending.length;
}

let receiptWorkerStarted = false;
let receiptPollRunning = false;

async function runReceiptPoll(): Promise<void> {
  if (receiptPollRunning) return;
  receiptPollRunning = true;
  try {
    const count = await pollPushReceipts();
    if (count > 0) {
      logger.info({ count }, "Processed Expo push receipts");
    }
  } catch (error) {
    logger.error({ err: error }, "Unexpected Expo receipt worker error");
  } finally {
    receiptPollRunning = false;
  }
}

export function startPushReceiptWorker(): void {
  if (receiptWorkerStarted) return;
  receiptWorkerStarted = true;
  const initial = setTimeout(() => void runReceiptPoll(), 5_000);
  initial.unref();
  const interval = setInterval(
    () => void runReceiptPoll(),
    RECEIPT_POLL_INTERVAL_MS,
  );
  interval.unref();
}