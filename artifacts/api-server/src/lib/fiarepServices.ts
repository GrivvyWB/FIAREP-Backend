// FIAREP's own outreach unit is called FIAREP Services. Every other company
// that switches the module on keeps the trade name, Community Coordinator.
// Accounts issued in FIAREP's organization under the old title are renamed
// once, at boot; both titles are accepted everywhere, so nothing breaks in
// between and a company that is not FIAREP is left alone.
import { eq, and } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import { COMMUNITY_TITLES } from "./domain";
import { logger } from "./logger";

export async function ensureFiarepServiceTitles(): Promise<void> {
  const pairs = [
    [COMMUNITY_TITLES.other.supervisor, COMMUNITY_TITLES.fiarep.supervisor],
    [COMMUNITY_TITLES.other.unit, COMMUNITY_TITLES.fiarep.unit],
  ] as const;
  for (const [from, to] of pairs) {
    const rows = await db.update(staffAccounts)
      .set({ position: to })
      .where(and(eq(staffAccounts.tenantId, "default"), eq(staffAccounts.position, from)))
      .returning({ id: staffAccounts.id });
    if (rows.length) logger.info({ from, to, count: rows.length }, "Renamed FIAREP community titles");
  }
}
