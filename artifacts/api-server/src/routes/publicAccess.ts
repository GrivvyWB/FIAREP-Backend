import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entityRecords, notifications } from "@workspace/db";

const router: IRouter = Router();
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
const record = (row: typeof entityRecords.$inferSelect) => ({
  id: row.id,
  entity: row.entity,
  projectId: row.projectId,
  development: row.development,
  state: row.state,
  deleted: row.deleted,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

async function releasedScope(trackingId: string) {
  const rows = await db
    .select()
    .from(entityRecords)
    .where(and(eq(entityRecords.entity, "procurement"), eq(entityRecords.deleted, false)))
    .orderBy(desc(entityRecords.updatedAt));
  return rows.find((row) => {
    const status = normalize(row.state["status"]);
    return normalize(row.state["trackingId"]) === normalize(trackingId) &&
      (status === "bidding" || status === "awarded");
  });
}

router.post("/v1/public/resident-reports", async (req, res) => {
  const input = req.body && typeof req.body === "object" ? req.body : {};
  const rawState = input.state && typeof input.state === "object" ? input.state : {};
  const address = String(rawState.address ?? "").trim();
  const description = String(rawState.description ?? "").trim();
  if (!address || !description) {
    res.status(400).json({ error: "Address and complaint description are required" });
    return;
  }
  const now = new Date();
  const complaintNo = `RC-${Math.floor(10000 + Math.random() * 90000)}`;
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID();
  const development = typeof rawState.development === "string" ? rawState.development.trim() : null;
  const state = {
    ...rawState,
    complaintNo,
    address,
    description,
    status: "submitted",
    photos: [],
    updates: [{ status: "submitted", by: "resident", at: now.toISOString() }],
    createdAt: now.toISOString(),
  };
  const [created] = await db.insert(entityRecords).values({
    id,
    tenantId: "default",
    entity: "resident-reports",
    development,
    state,
    createdBy: "public-resident",
    createdAt: now,
    updatedAt: now,
  }).returning();
  await db.insert(notifications).values([
    { id: randomUUID(), tenantId: "default", target: "management", message: "New resident report", detail: `${address} · ${complaintNo}`, reportId: id },
    { id: randomUUID(), tenantId: "default", target: "administrator", message: "New resident report", detail: `${address} · ${complaintNo}`, reportId: id },
  ]);
  res.status(201).json(record(created!));
});

router.get("/v1/public/resident-reports/:complaintNo", async (req, res) => {
  const complaintNo = normalize(req.params["complaintNo"]);
  const address = normalize(req.query["address"]);
  if (!complaintNo || !address) {
    res.status(400).json({ error: "Complaint number and address are required" });
    return;
  }
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, "resident-reports"),
    eq(entityRecords.deleted, false),
  )).orderBy(desc(entityRecords.updatedAt));
  res.json(rows.filter((row) =>
    normalize(row.state["complaintNo"]) === complaintNo &&
    normalize(row.state["address"]) === address
  ).map(record));
});

router.get("/v1/public/vendor-scopes/:trackingId", async (req, res) => {
  const vendorName = normalize(req.query["vendorName"]);
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!vendorName || !scope) {
    res.status(404).json({ error: "Released scope not found" });
    return;
  }
  if (
    normalize(scope.state["status"]) === "awarded" &&
    normalize(scope.state["vendor"]) !== vendorName
  ) {
    res.status(404).json({ error: "Released scope not found" });
    return;
  }
  res.json(record(scope));
});

router.post("/v1/public/vendor-scopes/:trackingId/bids", async (req, res) => {
  const vendorName = String(req.body?.vendorName ?? "").trim();
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note ?? "").trim();
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!scope || !vendorName || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "A released scope, vendor name, and positive amount are required" });
    return;
  }
  const now = new Date();
  const id = `public-bid-${createHash("sha256").update(`${scope.id}:${normalize(vendorName)}`).digest("hex").slice(0, 32)}`;
  const state = {
    requestId: scope.id,
    trackingId: String(scope.state["trackingId"] ?? req.params["trackingId"]),
    vendorName,
    amount,
    note: note || undefined,
    development: scope.development,
    submittedAt: now.toISOString(),
  };
  const [bid] = await db.insert(entityRecords).values({
    id,
    tenantId: scope.tenantId,
    entity: "procurement-bids",
    projectId: scope.projectId,
    development: scope.development,
    state,
    createdBy: `public-vendor:${normalize(vendorName)}`,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: entityRecords.id,
    set: { state, version: sql`${entityRecords.version} + 1`, updatedAt: now, deleted: false },
  }).returning();
  await db.insert(notifications).values({
    id: randomUUID(),
    tenantId: scope.tenantId,
    target: "procurement",
    message: `New bid on ${state.trackingId}`,
    detail: `${vendorName} · $${amount}`,
    reportId: scope.id,
  });
  res.status(201).json(record(bid!));
});

export default router;