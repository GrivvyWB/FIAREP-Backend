import app from "./app";
import { logger } from "./lib/logger";
import { ensureNychaCatalog } from "./lib/nycha-catalog";
import { ensureNotificationReadsTable } from "./lib/notificationReads";
import { ensureFiarepServiceTitles } from "./lib/fiarepServices";
import { ensureFiarepAdministrators } from "./lib/fiarepAdmins";
import { ensureSampleClient } from "./lib/sampleClient";
import { startPushReceiptWorker } from "./lib/push";
import { ensureCommandTables } from "./lib/command/tables";
import { ensureBookingTable } from "./lib/command/scheduling";
import { expireStaleProposals } from "./lib/command/engine";
import { expirePilots } from "./lib/pilot";
import { syncRelayDevices } from "./lib/command/relay";
import { ensureFilesTable } from "./lib/command/files";
import { ensureSmartRepairsTable } from "./routes/smartRepairs";
import { ensureResidentDeskTable } from "./lib/command/residentDesk";
import { ensureMoldTables, moldSweep } from "./lib/mold";
import { autoCheckOn } from "./routes/alerts";

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
await ensureSampleClient().catch((err) => console.error("Sample client not made:", err));
await ensureCommandTables();
await ensureBookingTable();
// Tables otherwise made on first use: made at start, so the development database
// has them too (Replit's Publish compares the two and offers to drop what's missing).
await Promise.all([ensureFilesTable(), ensureSmartRepairsTable(), ensureResidentDeskTable(), ensureMoldTables()]).catch((err) => console.error("Table setup:", err));
void syncRelayDevices();
setInterval(() => { void expireStaleProposals().catch(() => undefined); }, 60_000).unref();
// Pilot programs past their end date go back to the features they had before (unless purchased).
void expirePilots().catch(() => undefined);
setInterval(() => { void expirePilots().catch(() => undefined); }, 3_600_000).unref();
// Mold monitoring: HPD's open mold violations and the deadline warnings, twice a day (when automatic City checks are on).
const moldTick = () => { void autoCheckOn().then((on) => (on ? moldSweep() : undefined)).catch(() => undefined); };
setTimeout(moldTick, 5 * 60_000).unref();
setInterval(moldTick, 12 * 3_600_000).unref();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startPushReceiptWorker();
});
