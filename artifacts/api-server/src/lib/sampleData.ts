// Sample Client's buildings and work, made once, so App Review sees FIAREP working:
// three buildings, each with complaints, HPD violations, scopes, repairs and completions —
// some finished, some still waiting to be answered. Clearly sample addresses.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, entityRecords, organizationProperties, settings, staffAccounts } from "@workspace/db";
import { logger } from "./logger";
import { normalizeAddress } from "./jurisdiction";

const ORG = "ORG-SAMPLE";
const KEY = "sample-data-made";
const day = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

const BUILDINGS = [
  { address: "101 Sample Avenue", city: "Brooklyn", postal: "11201", units: 24 },
  { address: "202 Sample Street", city: "Bronx", postal: "10451", units: 36 },
  { address: "303 Sample Boulevard", city: "Queens", postal: "11101", units: 18 },
];

export async function ensureSampleData(): Promise<void> {
  await makeSampleData();
  await giveWorkToWorker();
}

/** The jobs done and under way belong to Sample Client's worker (the one added in Team), so they show on the worker's app.
 *  Done once a worker exists; the complaint at 303 Sample Boulevard stays unanswered. */
const WORKER_KEY = "sample-data-worker";
async function giveWorkToWorker(): Promise<void> {
  const [done] = await db.select().from(settings).where(and(eq(settings.tenantId, "default"), eq(settings.key, WORKER_KEY))).limit(1);
  if (done) return;
  const workers = await db.select({ id: staffAccounts.id, name: staffAccounts.name, position: staffAccounts.position }).from(staffAccounts)
    .where(and(eq(staffAccounts.tenantId, ORG), eq(staffAccounts.role, "worker"), eq(staffAccounts.status, "approved")));
  const w = workers.find((x) => x.name === "App Review Worker") ?? workers[0];
  if (!w) return;
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, ORG), inArray(entityRecords.entity, ["resident-reports", "building-violations", "change-orders"])));
  const now = new Date();
  for (const r of rows) {
    const st = r.state as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    if (r.entity === "resident-reports" && ["RC-10101", "RC-20202"].includes(String(st["complaintNo"]))) {
      next = { ...st, assignedStaffId: w.id, assignedTo: w.name, ...(st["completedAt"] ? { completedByStaffId: w.id, completedBy: w.name } : {}),
        updates: (Array.isArray(st["updates"]) ? st["updates"] as Array<Record<string, unknown>> : []).map((u) => (u["by"] === "resident" ? u : { ...u, by: w.name })) };
    } else if (r.entity === "building-violations" && ["V-10101", "V-20202"].includes(String(st["violationNo"]))) {
      next = { ...st, routedTo: w.name, assignedStaffId: w.id, routedToPosition: w.position || "Worker", ...(st["completedBy"] ? { completedBy: w.name } : {}) };
    } else if (r.entity === "change-orders" && st["createdByName"] === "Sample Technician") {
      next = { ...st, createdByName: w.name, createdById: w.id };
    }
    if (next) await db.update(entityRecords).set({ state: next, version: (r.version ?? 1) + 1, updatedAt: now }).where(eq(entityRecords.id, r.id));
  }
  await db.insert(settings).values({ tenantId: "default", key: WORKER_KEY, value: { at: now.toISOString(), worker: w.id }, createdAt: now, updatedAt: now }).onConflictDoNothing();
  logger.info({ organization: ORG, worker: w.name }, "Sample work given to the worker");
}

async function makeSampleData(): Promise<void> {
  const [done] = await db.select().from(settings).where(and(eq(settings.tenantId, "default"), eq(settings.key, KEY))).limit(1);
  if (done) return;
  const [admin] = await db.select({ id: staffAccounts.id, name: staffAccounts.name }).from(staffAccounts)
    .where(and(eq(staffAccounts.tenantId, ORG), eq(staffAccounts.name, "App Review"))).limit(1);
  if (!admin) return;
  const by = admin.name;
  const full = (b: typeof BUILDINGS[number]) => `${b.address}, ${b.city}, NY ${b.postal}`;
  const now = new Date();
  const rec = (entity: string, state: Record<string, unknown>, createdAt: string) => ({
    id: randomUUID(), tenantId: ORG, entity, development: null, state, createdBy: admin.id, deleted: false, version: 1,
    createdAt: new Date(createdAt), updatedAt: now,
  });
  const [b1, b2, b3] = BUILDINGS as [typeof BUILDINGS[number], typeof BUILDINGS[number], typeof BUILDINGS[number]];

  // ── 101 Sample Avenue: everything finished ──
  const c1 = rec("resident-reports", {
    complaintNo: "RC-10101", residentName: "Sample Resident", unit: "3B", address: full(b1), location: "Kitchen", development: "",
    description: "Water leaking under the kitchen sink.", photos: [], createdBy: "resident",
    status: "work_approved", assignedStaffId: admin.id, assignedTo: by,
    updates: [{ status: "submitted", by: "resident", at: day(20) }, { status: "assigned", by, at: day(20) }, { status: "in_progress", by, at: day(19) }, { status: "done", by, at: day(18) }, { status: "work_approved", by, at: day(17) }],
    createdAt: day(20), arrivalAt: day(19), completedAt: day(18), resolvedAt: day(17),
    completionNote: "Replaced the P-trap and supply line under the sink. No more leak.", rating: 5,
  }, day(20));
  const v1 = rec("building-violations", {
    building: full(b1), violationNo: "V-10101", code: "670", codeDesc: "Provide hot water at all hot water fixtures", hazardClass: "C",
    notes: "Apartment 5A, no hot water at bathroom sink.", loggedBy: by, loggedAt: day(15),
    status: "done", approvedBy: by, approvedAt: day(15), routedTo: by, assignedStaffId: admin.id, routedToPosition: "Plumber", routedAt: day(15),
    completedBy: by, completedAt: day(13), completionNote: "Repaired the mixing valve; hot water restored. Certification filed.",
  }, day(15));
  const s1 = rec("procurement", {
    trackingId: "sr-10101", projectId: "", address: full(b1), scope: "Replace the boiler room mixing valve and insulate the hot water line.",
    status: "closed", requestedBy: by, requestedAt: day(14), approvedBy: by, approvedAt: day(14), vendor: "Sample Plumbing Co.", awardedBy: by, awardedAt: day(14),
    startedAt: day(13), completedAt: day(12), closedAt: day(12), amountCharged: 1250, finalAmount: 1250,
    violationNo: "V-10101", violationCode: "670", violationCodeDesc: "Provide hot water at all hot water fixtures", hazardClass: "C", sourceRef: "V-10101",
  }, day(14));

  // ── 202 Sample Street: work under way ──
  const c2 = rec("resident-reports", {
    complaintNo: "RC-20202", residentName: "Sample Resident", unit: "6D", address: full(b2), location: "Living room", development: "",
    description: "No heat in the apartment since last night.", photos: [], createdBy: "resident",
    status: "in_progress", assignedStaffId: admin.id, assignedTo: by,
    updates: [{ status: "submitted", by: "resident", at: day(2) }, { status: "assigned", by, at: day(2) }, { status: "in_progress", by, at: day(1) }],
    createdAt: day(2), arrivalAt: day(1),
  }, day(2));
  const v2 = rec("building-violations", {
    building: full(b2), violationNo: "V-20202", code: "666", codeDesc: "Provide an adequate supply of heat for the apartment", hazardClass: "C",
    notes: "Apartment 6D, inside 58°F.", loggedBy: by, loggedAt: day(2),
    status: "routed", approvedBy: by, approvedAt: day(2), routedTo: by, assignedStaffId: admin.id, routedToPosition: "Heating Service", routedAt: day(1),
    complaintNo: "RC-20202",
  }, day(2));
  const s2 = rec("procurement", {
    trackingId: "sr-20202", projectId: "", address: full(b2), scope: "Repair the boiler burner and replace two radiator valves in 6D.",
    status: "bidding", requestedBy: by, requestedAt: day(1), approvedBy: by, approvedAt: day(1),
    violationNo: "V-20202", violationCode: "666", violationCodeDesc: "Provide an adequate supply of heat for the apartment", hazardClass: "C", sourceRef: "V-20202", complaintNo: "RC-20202",
  }, day(1));

  // ── 303 Sample Boulevard: still waiting to be answered ──
  const c3 = rec("resident-reports", {
    complaintNo: "RC-30303", residentName: "Sample Resident", unit: "2A", address: full(b3), location: "Bathroom", development: "",
    description: "Mold on the bathroom ceiling above the shower.", photos: [], createdBy: "resident",
    status: "submitted", updates: [{ status: "submitted", by: "resident", at: day(0) }], createdAt: day(0),
  }, day(0));
  const v3 = rec("building-violations", {
    building: full(b3), violationNo: "V-30303", code: "550", codeDesc: "Trace and repair the source and abate the nuisance consisting of mold", hazardClass: "B",
    notes: "Apartment 2A bathroom ceiling, about 12 sq ft.", loggedBy: by, loggedAt: day(0), status: "logged",
  }, day(0));
  const s3 = rec("procurement", {
    trackingId: "sr-30303", projectId: "", address: full(b3), scope: "Find and repair the leak above the 2A bathroom, remove mold, repaint the ceiling.",
    status: "submitted", requestedBy: by, requestedAt: day(0),
    violationNo: "V-30303", violationCode: "550", violationCodeDesc: "Trace and repair the source and abate the nuisance consisting of mold", hazardClass: "B", sourceRef: "V-30303",
  }, day(0));
  const co = rec("change-orders", {
    reportId: c2.id, reportRef: full(b2), targetPosition: "Heating Service", targetName: by,
    description: "Second radiator in the bedroom also needs a new valve.", cost: 350, photos: [], status: "submitted", reason: "",
    createdByRole: "worker", createdByName: "Sample Technician", respondedByName: "", createdAt: day(1), respondedAt: "",
  }, day(1));

  await db.transaction(async (tx) => {
    await tx.insert(organizationProperties).values(BUILDINGS.map((b) => ({
      id: randomUUID(), organizationId: ORG, displayAddress: full(b), normalizedAddress: normalizeAddress(b.address, b.city, "NY"),
      city: b.city, state: "NY", postalCode: b.postal, units: b.units, active: true,
    }))).onConflictDoNothing();
    await tx.insert(entityRecords).values([c1, v1, s1, c2, v2, s2, c3, v3, s3, co]);
    await tx.insert(settings).values({ tenantId: "default", key: KEY, value: { at: now.toISOString() }, createdAt: now, updatedAt: now }).onConflictDoNothing();
  });
  logger.info({ organization: ORG }, "Sample buildings and work ready");
}
