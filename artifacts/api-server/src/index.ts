import app from "./app";
import { logger } from "./lib/logger";
import { ensureNychaCatalog } from "./lib/nycha-catalog";
import { ensureNotificationReadsTable } from "./lib/notificationReads";
import { ensureFiarepServiceTitles } from "./lib/fiarepServices";
import { ensureFiarepAdministrators } from "./lib/fiarepAdmins";
import { startPushReceiptWorker } from "./lib/push";
import { ensureCommandTables } from "./lib/command/tables";
import { ensureBookingTable } from "./lib/command/scheduling";
import { expireStaleProposals } from "./lib/command/engine";
import { expirePilots } from "./lib/pilot";
import { syncRelayDevices } from "./lib/command/relay";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await ensureNychaCatalog();
await ensureNotificationReadsTable();
await ensureFiarepServiceTitles();
await ensureFiarepAdministrators();
await ensureCommandTables();
await ensureBookingTable();
void syncRelayDevices();
setInterval(() => { void expireStaleProposals().catch(() => undefined); }, 60_000).unref();
// Pilot programs past their end date go back to the features they had before (unless purchased).
void expirePilots().catch(() => undefined);
setInterval(() => { void expirePilots().catch(() => undefined); }, 3_600_000).unref();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startPushReceiptWorker();
});
