// The sample client App Review (and testing) signs in to:
//   Organization ID  ORG-SAMPLE
//   Name             App Review
//   Code             Q382
// Made once, at the first boot after this was added, with every module on. Change or
// delete it in Platform Control like any company — a deleted one is not made again.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, organizations, settings, staffAccounts } from "@workspace/db";
import { logger } from "./logger";
import { newResidentCode, withResidentCode } from "./residentRouting";

export const SAMPLE_CLIENT = { id: "ORG-SAMPLE", name: "Sample Client", user: "App Review", code: "Q382" } as const;
const MADE_KEY = "sample-client-made";
const ON = ["proj-new", "proj-room", "proj-rates", "proj-checklist", "proj-inspection", "proj-estimate", "proj-scope", "proj-intake",
  "proj-elevator", "proj-photos", "proj-scans", "proj-roofplan", "proj-compass", "measurement"];

export async function ensureSampleClient(): Promise<void> {
  const [made] = await db.select().from(settings).where(and(eq(settings.tenantId, "default"), eq(settings.key, MADE_KEY))).limit(1);
  if (made) return;
  await db.transaction(async (tx) => {
    const [org] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, SAMPLE_CLIENT.id)).limit(1);
    if (!org) {
      const features = withResidentCode({ modules: Object.fromEntries(ON.map((m) => [m, true])) }, await newResidentCode());
      await tx.insert(organizations).values({ id: SAMPLE_CLIENT.id, name: SAMPLE_CLIENT.name, status: "active", hrEmail: "fiarep@outlook.com", features, unrestricted: true });
      await tx.insert(staffAccounts).values({
        id: randomUUID(), tenantId: SAMPLE_CLIENT.id, name: SAMPLE_CLIENT.user, code: SAMPLE_CLIENT.code,
        role: "administrator", position: "Borough Director", status: "approved", developments: [], issuerName: "Platform owner",
      });
    }
    const now = new Date();
    await tx.insert(settings).values({ tenantId: "default", key: MADE_KEY, value: { at: now.toISOString() }, createdAt: now, updatedAt: now }).onConflictDoNothing();
  });
  logger.info({ organization: SAMPLE_CLIENT.id }, "Sample client ready");
}
