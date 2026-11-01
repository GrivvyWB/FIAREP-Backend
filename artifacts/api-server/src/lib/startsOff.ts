// Every app button and website menu item at a client starts OFF ("startsOff"): it shows once
// FIAREP switches it on in Platform Control, or once its criteria are done (the baseline
// walk-through turns on the complaint buttons). FIAREP's switches always decide after that.
import { eq, ne } from "drizzle-orm";
import { db, organizations } from "@workspace/db";
import { logger } from "./logger";

const FIAREP_TENANT = "default";
const SCREENS = ["management", "admin", "cpm", "tech", "worker", "community", "resident", "vendor"];
const COMPLAINT_SLUGS = ["resident-reports", "manage-all-requests", "review-reports", "priority-queue"];
const COMPLAINT_MENU = ["menu.complaint-dashboard", "menu.notifications"];
/** The complaint buttons the baseline walk-through turns on, on the app and the website. */
export const COMPLAINT_SWITCHES = [...SCREENS.flatMap((s) => COMPLAINT_SLUGS.map((c) => `apptab.${s}.${c}`)), ...COMPLAINT_MENU];

type Features = Record<string, unknown> & { modules?: Record<string, unknown> };

/** A new client: everything starts off, and complaint work waits for the baseline. */
export const startOff = (features: Features): Features => ({ ...features, startsOffSince: new Date().toISOString(), modules: { ...(features.modules || {}), startsOff: true, requireBaseline: true } });

/** Criteria done (baseline complete): the complaint buttons and complaint work turn on for the client. */
export async function turnOnComplaints(orgId: string): Promise<void> {
  if (!orgId || orgId === FIAREP_TENANT) return;
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return;
  const f = (org.features ?? {}) as Features;
  const modules = { ...(f.modules || {}), ...Object.fromEntries(COMPLAINT_SWITCHES.map((k) => [k, true])), requireBaseline: false };
  await db.update(organizations).set({ features: { ...f, modules }, updatedAt: new Date() }).where(eq(organizations.id, orgId));
  logger.info({ organization: orgId }, "Baseline done: complaint buttons on");
}

/** Once per client: every company-level app button and website menu switch goes back to unset (= off),
 *  each person's own switches are kept, and complaint work waits for the baseline (on already if it is done). */
export async function startEveryClientOff(hasCompleteBaseline: (orgId: string) => Promise<boolean>): Promise<void> {
  const orgs = await db.select({ id: organizations.id, features: organizations.features }).from(organizations).where(ne(organizations.id, FIAREP_TENANT));
  for (const org of orgs) {
    const f = (org.features ?? {}) as Features;
    if (f["startsOffSince"]) continue;
    const kept = Object.fromEntries(Object.entries(f.modules || {}).filter(([k]) => !k.startsWith("apptab.") && !k.startsWith("menu.")));
    const done = await hasCompleteBaseline(org.id).catch(() => false);
    const modules = { ...kept, startsOff: true, requireBaseline: !done, ...(done ? Object.fromEntries(COMPLAINT_SWITCHES.map((k) => [k, true])) : {}) };
    await db.update(organizations).set({ features: { ...f, startsOffSince: new Date().toISOString(), modules }, updatedAt: new Date() }).where(eq(organizations.id, org.id));
    logger.info({ organization: org.id, baselineDone: done }, "Client starts off");
  }
}
