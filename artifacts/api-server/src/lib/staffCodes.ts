import { and, eq, sql } from "drizzle-orm";
import { staffAccounts } from "@workspace/db";
import { staffCode } from "./domain";

const STAFF_CODE_ATTEMPTS = 30;

export function truckStaffCode(truckNumber: number): string {
  if (!Number.isInteger(truckNumber) || truckNumber < 1 || truckNumber > 999) {
    throw Object.assign(new Error("Truck number must be between 1 and 999"), { status: 400 });
  }
  return truckNumber < 10
    ? `TRK${truckNumber}`
    : `T${String(truckNumber).padStart(3, "0")}`;
}

export async function allocateStaffCode(
  tx: any,
  tenantId: string,
  name: string,
): Promise<string> {
  const normalizedName = name.trim().toLowerCase();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-code:${tenantId}:${normalizedName}`}))`);
  for (let attempt = 0; attempt < STAFF_CODE_ATTEMPTS; attempt += 1) {
    const candidate = staffCode();
    const matches = await tx.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, tenantId),
      sql`lower(${staffAccounts.name}) = ${normalizedName}`,
      eq(staffAccounts.code, candidate),
    )).limit(1);
    if (matches.length === 0) return candidate;
  }
  throw Object.assign(new Error("Unable to allocate a unique staff code"), { status: 503 });
}