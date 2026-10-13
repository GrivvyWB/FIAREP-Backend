// Quick quote: FIAREP walks a building, sees what needs replacing, prices it
// off the repair book and either sends it to the owner to approve or approves
// it on the spot.
//
// It hangs off a project, because that is where the walk already lives and
// because a project takes photographs. The phone sends the item and how many;
// the server prices it, so a price is never typed on site.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, entityRecords, notifications, organizationProperties, organizations, staffAccounts } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { deliverPushNotification } from "../lib/push";
import { catalogPrice } from "../lib/repairCatalog";
import { FIAREP_TENANT } from "../lib/fiarepDispatch";

const router: IRouter = Router();
const text = (v: unknown, max = 300): string => String(v ?? "").trim().slice(0, max);

export type QuickLine = {
  id: string; key: string; label: string; unit: string;
  qty: number; unitPrice: number; amount: number; note: string; photo: string;
};
export type QuickQuote = {
  lines: QuickLine[];
  total: number;
  status: "approved" | "pending" | "declined";
  /** "fiarep" when FIAREP approved it themselves, "client" when the owner must. */
  decidedBy: string;
  approvedBySelf: boolean;
  clientTenantId: string;
  clientCompany: string;
  building: string;
  note: string;
  sentAt: string;
  sentBy: string;
  decidedAt: string;
};

async function overrides(): Promise<Record<string, number>> {
  const [row] = await db.select().from(entityRecords)
    .where(and(eq(entityRecords.entity, "pricing-overrides"), eq(entityRecords.id, "pricing-overrides")))
    .limit(1);
  const items = (row?.state as Record<string, unknown> | undefined)?.["items"];
  return items && typeof items === "object" && !Array.isArray(items) ? (items as Record<string, number>) : {};
}

/** The companies a quote can be sent to: every client on the platform. */
router.get("/v1/fiarep/clients", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT) { res.status(403).json({ error: "FIAREP only." }); return; }
  const rows = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(ne(organizations.id, FIAREP_TENANT)).orderBy(asc(organizations.name));
  res.setHeader("Cache-Control", "no-store");
  res.json(rows);
});

/** Every building registered to a client, so a walk can be priced against one
 *  without anything having to sync up from a phone first. */
router.get("/v1/fiarep/buildings", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT) { res.status(403).json({ error: "FIAREP only." }); return; }
  const rows = await db.select({
    id: organizationProperties.id,
    address: organizationProperties.displayAddress,
    city: organizationProperties.city,
    state: organizationProperties.state,
    organizationId: organizationProperties.organizationId,
    company: organizations.name,
  }).from(organizationProperties)
    .leftJoin(organizations, eq(organizations.id, organizationProperties.organizationId))
    .orderBy(asc(organizationProperties.displayAddress))
    .limit(2000);
  res.setHeader("Cache-Control", "no-store");
  res.json(rows.filter((r) => r.organizationId !== FIAREP_TENANT));
});

/** The walk needs somewhere to hang: the project for this address, or a new
 *  one. Projects made on a phone may not have reached the server yet, so this
 *  never waits for one. */
router.post("/v1/fiarep/quick-quote/start", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT) { res.status(403).json({ error: "FIAREP only." }); return; }
  const address = text((req.body ?? {})["address"], 200);
  const company = text((req.body ?? {})["company"], 200);
  if (address.length < 3) { res.status(400).json({ error: "Which building?" }); return; }

  const existing = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, "projects"), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(500);
  const match = existing.find((r) => text(r.state["name"], 200).toLowerCase() === address.toLowerCase());
  if (match) { res.json({ projectId: match.id, created: false }); return; }

  const id = randomUUID();
  const now = new Date();
  await db.insert(entityRecords).values({
    id, tenantId: FIAREP_TENANT, entity: "projects", version: 1,
    state: { name: address, client: company, createdAt: now.toISOString(), createdByQuickQuote: true },
    createdBy: actor.id, createdAt: now, updatedAt: now,
  });
  await audit(actor, "projects.created-for-quick-quote", address, id);
  res.status(201).json({ projectId: id, created: true });
});

/** Price what the walk found, and either send it or approve it. */
router.post("/v1/fiarep/projects/:id/quick-quote", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT) { res.status(403).json({ error: "Only FIAREP price a job this way." }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = text(body["mode"]) === "self" ? "self" : "client";
  const input = Array.isArray(body["lines"]) ? (body["lines"] as Array<Record<string, unknown>>) : [];
  if (input.length === 0) { res.status(400).json({ error: "Add at least one item." }); return; }

  const [project] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, String(req.params["id"] || "")), eq(entityRecords.entity, "projects"),
    eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!project) { res.status(404).json({ error: "No such project." }); return; }

  const book = await overrides();
  const lines: QuickLine[] = [];
  for (const raw of input.slice(0, 50)) {
    const key = text(raw["key"], 60);
    const found = catalogPrice(key, book);
    if (!found) { res.status(400).json({ error: `"${key}" is not in the price book.` }); return; }
    const qty = Number(raw["qty"]);
    if (!Number.isFinite(qty) || qty <= 0) { res.status(400).json({ error: `Enter how many for ${found.label}.` }); return; }
    const rounded = Math.round(qty * 100) / 100;
    lines.push({
      id: randomUUID(), key, label: found.label, unit: found.unit, qty: rounded,
      unitPrice: found.price, amount: Math.round(found.price * rounded * 100) / 100,
      note: text(raw["note"]), photo: text(raw["photo"]),
    });
  }
  const total = Math.round(lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
  const now = new Date();

  let clientTenantId = text(body["clientTenantId"], 64);
  let clientCompany = "";
  if (mode === "client") {
    if (!clientTenantId || clientTenantId === FIAREP_TENANT) { res.status(400).json({ error: "Pick the company that has to approve it." }); return; }
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, clientTenantId)).limit(1);
    if (!org) { res.status(404).json({ error: "No such company." }); return; }
    clientCompany = org.name;
  } else {
    clientTenantId = "";
  }

  const quote: QuickQuote = {
    lines, total,
    status: mode === "self" ? "approved" : "pending",
    decidedBy: mode === "self" ? actor.name : "",
    approvedBySelf: mode === "self",
    clientTenantId, clientCompany,
    building: text(body["building"], 200) || text(project.state["name"], 200),
    note: text(body["note"], 500),
    sentAt: now.toISOString(),
    sentBy: actor.name,
    decidedAt: mode === "self" ? now.toISOString() : "",
  };

  await db.update(entityRecords)
    .set({ state: { ...project.state, quickQuote: quote }, version: (project.version ?? 1) + 1, updatedAt: now })
    .where(and(eq(entityRecords.id, project.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
  await audit(actor, mode === "self" ? "projects.quick-quote-approved" : "projects.quick-quote-sent",
    `${lines.length} item(s), $${total.toFixed(2)}${clientCompany ? ` · ${clientCompany}` : ""}`, project.id);

  // The owner hears about it either way: asked when it needs approving, told
  // when FIAREP approved it themselves.
  if (clientTenantId) {
    const staff = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, clientTenantId), eq(staffAccounts.status, "approved"),
      inArray(staffAccounts.role, ["administrator", "management"]),
    ));
    if (staff.length) {
      const rows = await db.insert(notifications).values(staff.map((s) => ({
        id: randomUUID(), tenantId: clientTenantId, target: s.id,
        message: `FIAREP needs approval — $${total.toFixed(2)}`,
        detail: [quote.building, lines.map((l) => `${l.qty} × ${l.label}`).join(", ")].filter(Boolean).join(" · ").slice(0, 400),
        reportId: project.id,
      }))).returning();
      for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
    }
  }
  res.status(201).json(quote);
});

export default router;
