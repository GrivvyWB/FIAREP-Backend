import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { lookupNychaResidentialAddress } from "./nycProperty";
import { logger } from "./logger";

type EntityRecord = typeof entityRecords.$inferSelect;

export async function repairLegacyResidentDevelopment(
  row: EntityRecord,
): Promise<EntityRecord> {
  const stateDevelopment = typeof row.state["development"] === "string"
    ? row.state["development"].trim()
    : "";
  if (
    row.entity !== "resident-reports" ||
    row.development?.trim() ||
    stateDevelopment ||
    row.deleted
  ) {
    return row;
  }
  const address = typeof row.state["address"] === "string"
    ? row.state["address"].trim()
    : "";
  if (!address) return row;

  try {
    const match = await lookupNychaResidentialAddress(address);
    const development = match?.development?.trim();
    if (!development) return row;
    const now = new Date();
    const [updated] = await db.update(entityRecords)
      .set({
        development,
        state: { ...row.state, development },
        version: row.version + 1,
        updatedAt: now,
      })
      .where(and(
        eq(entityRecords.id, row.id),
        eq(entityRecords.tenantId, row.tenantId),
        eq(entityRecords.entity, "resident-reports"),
        eq(entityRecords.version, row.version),
        eq(entityRecords.deleted, false),
      ))
      .returning();
    return updated ?? { ...row, development, state: { ...row.state, development } };
  } catch (error) {
    logger.warn(
      { error, reportId: row.id },
      "Could not resolve legacy resident report development",
    );
    return row;
  }
}