// FIAREP's administrators are named, not picked: Timothy Winn and Emily Winn.
// On FIAREP's own organization ("default") an account with either name is an
// Administrator — the people every request inside FIAREP goes to for approval.
// Emily becomes one the first time her account is used, or at the next boot,
// whichever comes first; nobody has to remember to switch her over.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import { logger } from "./logger";

import { FIAREP_ADMIN_NAMES, FIAREP_TENANT_ID, isFiarepAdmin } from "./fiarepAdminNames";
export { FIAREP_ADMIN_NAMES, FIAREP_TENANT_ID, isFiarepAdmin };

/** Boot: every named administrator on FIAREP's organization holds the role. */
export async function ensureFiarepAdministrators(): Promise<void> {
  const rows = await db.update(staffAccounts)
    .set({ role: "administrator", updatedAt: new Date() })
    .where(and(
      eq(staffAccounts.tenantId, FIAREP_TENANT_ID),
      ne(staffAccounts.role, "administrator"),
      inArray(sql`lower(regexp_replace(trim(${staffAccounts.name}), '\\s+', ' ', 'g'))`, [...FIAREP_ADMIN_NAMES]),
    ))
    .returning({ id: staffAccounts.id, name: staffAccounts.name });
  if (rows.length) logger.info({ names: rows.map((r) => r.name) }, "FIAREP administrators set");
}

/** Per request: an account that should be an administrator and is not yet
 *  becomes one now (the session stays valid — only the role changes). */
export async function promoteIfFiarepAdmin<T extends { id: string; tenantId: string; name: string; role: string }>(staff: T): Promise<T> {
  if (staff.role === "administrator" || !isFiarepAdmin(staff)) return staff;
  const [row] = await db.update(staffAccounts)
    .set({ role: "administrator", updatedAt: new Date() })
    .where(eq(staffAccounts.id, staff.id))
    .returning();
  logger.info({ name: staff.name }, "FIAREP administrator set");
  return (row as unknown as T) ?? { ...staff, role: "administrator" };
}
