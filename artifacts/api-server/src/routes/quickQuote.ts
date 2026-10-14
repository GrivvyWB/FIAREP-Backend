// Quick quote: FIAREP walks a building, sees what needs replacing, prices it
// off the repair book and either sends it to the owner to approve or approves
// it on the spot.
//
// It hangs off a project, because that is where the walk already lives and
// because a project takes photographs. The phone sends the item and how many;
// the server prices it, so a price is never typed on site.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db, entityRecords, notifications, organizationProperties, organizations, staffAccounts } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { deliverPushNotification } from "../lib/push";
import { catalogPrice } from "../lib/repairCatalog";
import { repairMaterials } from "../lib/repairMaterials";
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
  /** admin_review: a technician priced it; FIAREP's administrator approves
   *  it, turns it back, or sends it to the owner. pending: with the owner. */
  status: "admin_review" | "approved" | "pending" | "declined";
  /** "fiarep" when FIAREP approved it themselves, "client" when the owner must. */
  decidedBy: string;
  approvedBySelf: boolean;
  clientTenantId: string;
  clientCompany: string;
  building: string;
  note: string;
  sentAt: string;
  sentBy: string;
  sentById?: string;
  decidedAt: string;
};

/** The owner's management hear about a quote: asked when it needs approving. */
async function tellOwner(clientTenantId: string, quote: QuickQuote, projectId: string): Promise<void> {
  const staff = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, clientTenantId), eq(staffAccounts.status, "approved"),
    inArray(staffAccounts.role, ["administrator", "management"]),
  ));
  if (!staff.length) return;
  const rows = await db.insert(notifications).values(staff.map((s) => ({
    id: randomUUID(), tenantId: clientTenantId, target: s.id,
    message: `FIAREP needs approval — $${quote.total.toFixed(2)}`,
    detail: [quote.building, quote.lines.map((l) => `${l.qty} × ${l.label}`).join(", ")].filter(Boolean).join(" · ").slice(0, 400),
    reportId: projectId,
  }))).returning();
  for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
}

/** Tell people on FIAREP's own side. */
async function tellFiarep(targets: string[], message: string, detail: string, projectId: string): Promise<void> {
  const ids = [...new Set(targets.filter(Boolean))];
  if (!ids.length) return;
  const rows = await db.insert(notifications).values(ids.map((target) => ({
    id: randomUUID(), tenantId: FIAREP_TENANT, target, message, detail: detail.slice(0, 400), reportId: projectId,
  }))).returning();
  for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
}

async function fiarepAdministrators(): Promise<string[]> {
  const rows = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"), eq(staffAccounts.role, "administrator"),
  ));
  return rows.map((r) => r.id);
}

async function companyName(id: string): Promise<string | null> {
  if (!id || id === FIAREP_TENANT) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, id)).limit(1);
  return org?.name ?? null;
}

async function overrides(): Promise<Record<string, number>> {
  const [row] = await db.select().from(entityRecords)
    .where(and(eq(entityRecords.entity, "pricing-overrides"), eq(entityRecords.id, "pricing-overrides")))
    .limit(1);
  const items = (row?.state as Record<string, unknown> | undefined)?.["items"];
  return items && typeof items === "object" && !Array.isArray(items) ? (items as Record<string, number>) : {};
}

/** The materials book: what a part costs to buy. FIAREP only — this is the
 *  cost basis, so it never rides along on the public pricing payload. */
router.get("/v1/fiarep/materials", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT) { res.status(403).json({ error: "FIAREP only." }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json({ materials: repairMaterials(await overrides()) });
});

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
/** Every quote already written, newest first, so one can be pulled up again
 *  and reprinted without rebuilding it. Carries the whole quote because the
 *  receipt is printed from it on the device. */
router.get("/v1/fiarep/quotes", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT) { res.status(403).json({ error: "FIAREP only." }); return; }
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, "projects"),
    eq(entityRecords.tenantId, FIAREP_TENANT),
    eq(entityRecords.deleted, false),
  )).limit(1000);
  const out = rows
    .map((r) => ({ projectId: r.id, quote: r.state["quickQuote"] as QuickQuote | undefined }))
    .filter((r): r is { projectId: string; quote: QuickQuote } => !!r.quote && Array.isArray(r.quote.lines))
    .sort((a, b) => String(b.quote.sentAt || "").localeCompare(String(a.quote.sentAt || "")))
    .slice(0, 200);
  res.setHeader("Cache-Control", "no-store");
  res.json(out);
});

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
  // Hand back the quote already on this building so it reappears instead of
  // looking like nothing was ever priced here.
  if (match) {
    const prior = match.state["quickQuote"] as QuickQuote | undefined;
    res.json({ projectId: match.id, created: false, quote: prior && Array.isArray(prior.lines) ? prior : null });
    return;
  }

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
  const asked = text(body["mode"]);
  const mode: "self" | "client" | "admin" = asked === "self" ? "self" : asked === "client" ? "client" : "admin";
  // Technicians have no approval rights and never send to the owner: every
  // quote of theirs goes to FIAREP's administrator.
  if (actor.role !== "administrator" && mode !== "admin") {
    res.status(403).json({ error: "Send it to the administrator — only the administrator approves a quote or sends it to the owner." });
    return;
  }
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
    const name = await companyName(clientTenantId);
    if (!name) { res.status(404).json({ error: "No such company." }); return; }
    clientCompany = name;
  } else if (mode === "admin") {
    // The technician may say whose building it is; the administrator decides.
    const name = await companyName(clientTenantId);
    if (name) clientCompany = name; else clientTenantId = "";
  } else {
    clientTenantId = "";
  }

  const quote: QuickQuote = {
    lines, total,
    status: mode === "self" ? "approved" : mode === "admin" ? "admin_review" : "pending",
    decidedBy: mode === "self" ? actor.name : "",
    approvedBySelf: mode === "self",
    clientTenantId, clientCompany,
    building: text(body["building"], 200) || text(project.state["name"], 200),
    note: text(body["note"], 500),
    sentAt: now.toISOString(),
    sentBy: actor.name,
    sentById: actor.id,
    decidedAt: mode === "self" ? now.toISOString() : "",
  };

  await db.update(entityRecords)
    .set({ state: { ...project.state, quickQuote: quote }, version: (project.version ?? 1) + 1, updatedAt: now })
    .where(and(eq(entityRecords.id, project.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
  await audit(actor, mode === "self" ? "projects.quick-quote-approved" : mode === "admin" ? "projects.quick-quote-to-admin" : "projects.quick-quote-sent",
    `${lines.length} item(s), $${total.toFixed(2)}${clientCompany ? ` · ${clientCompany}` : ""}`, project.id);

  if (mode === "admin") {
    await tellFiarep(await fiarepAdministrators(), `Quote to approve — $${total.toFixed(2)} from ${actor.name}`,
      [quote.building, lines.map((l) => `${l.qty} × ${l.label}`).join(", ")].filter(Boolean).join(" · "), project.id);
  } else if (clientTenantId) {
    await tellOwner(clientTenantId, quote, project.id);
  }
  res.status(201).json(quote);
});

/** FIAREP's administrator acts on a technician's quote: approves it, turns it
 *  back, or sends it to the owner. Nobody else can. */
router.post("/v1/fiarep/projects/:id/quick-quote/review", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT || actor.role !== "administrator") {
    res.status(403).json({ error: "Only FIAREP's administrator approves a quote or sends it to the owner." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = ["approve", "decline", "send"].includes(text(body["decision"])) ? text(body["decision"]) as "approve" | "decline" | "send" : null;
  if (!decision) { res.status(400).json({ error: "Approve, turn back, or send to the owner." }); return; }
  const [project] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, String(req.params["id"] || "")), eq(entityRecords.entity, "projects"),
    eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!project) { res.status(404).json({ error: "No such project." }); return; }
  const current = project.state["quickQuote"] as QuickQuote | undefined;
  if (!current || !Array.isArray(current.lines)) { res.status(404).json({ error: "There is no quote on this one." }); return; }
  if (current.status !== "admin_review") { res.status(409).json({ error: `This one was already ${current.status === "pending" ? "sent to the owner" : current.status}.` }); return; }

  const now = new Date();
  let quote: QuickQuote;
  if (decision === "send") {
    const clientTenantId = text(body["clientTenantId"], 64) || current.clientTenantId;
    const name = await companyName(clientTenantId);
    if (!name) { res.status(400).json({ error: "Pick the company that has to approve it." }); return; }
    quote = { ...current, status: "pending", clientTenantId, clientCompany: name, sentAt: now.toISOString() };
  } else {
    quote = {
      ...current,
      status: decision === "approve" ? "approved" : "declined",
      approvedBySelf: decision === "approve",
      decidedBy: actor.name,
      decidedAt: now.toISOString(),
      ...(text(body["note"], 500) ? { note: text(body["note"], 500) } : {}),
    };
  }
  await db.update(entityRecords)
    .set({ state: { ...project.state, quickQuote: quote }, version: (project.version ?? 1) + 1, updatedAt: now })
    .where(and(eq(entityRecords.id, project.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
  await audit(actor, `projects.quick-quote-${decision === "send" ? "sent" : decision === "approve" ? "approved" : "turned-back"}`,
    `$${quote.total.toFixed(2)}${quote.clientCompany ? ` · ${quote.clientCompany}` : ""}`, project.id);

  if (decision === "send") await tellOwner(quote.clientTenantId, quote, project.id);
  const outcome = decision === "send" ? `sent your quote to ${quote.clientCompany}` : decision === "approve" ? "approved your quote — go ahead" : "turned your quote back";
  await tellFiarep([current.sentById || ""], `${actor.name} ${outcome}`, quote.building, project.id);
  res.json(quote);
});

/** Throw a quote away. The project it opened goes too when quick quote made
 *  it and nothing else was ever put in it, so a test leaves nothing behind.
 *  An alert already sent to a client cannot be unsent; the quote they were
 *  told about simply stops existing. */
router.delete("/v1/fiarep/projects/:id/quick-quote", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (actor.tenantId !== FIAREP_TENANT) { res.status(403).json({ error: "FIAREP only." }); return; }
  const [project] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, String(req.params["id"] || "")), eq(entityRecords.entity, "projects"),
    eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!project) { res.status(404).json({ error: "No such project." }); return; }
  const quote = project.state["quickQuote"] as QuickQuote | undefined;
  if (!quote) { res.status(404).json({ error: "There is no quote on this one." }); return; }

  const now = new Date();
  const rest: Record<string, unknown> = { ...project.state };
  delete rest["quickQuote"];

  // Was this project only ever a holder for the quote? Then it goes as well.
  const [{ value: children }] = await db.select({ value: count() }).from(entityRecords).where(and(
    eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
    sql`${entityRecords.state}->>'projectId' = ${project.id}`,
  ));
  const bare = project.state["createdByQuickQuote"] === true && Number(children) === 0;

  await db.update(entityRecords)
    .set({ state: rest, deleted: bare, version: (project.version ?? 1) + 1, updatedAt: now })
    .where(and(eq(entityRecords.id, project.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
  await audit(actor, "projects.quick-quote-deleted", `$${(quote.total ?? 0).toFixed(2)}${bare ? " · project removed too" : ""}`, project.id);
  res.json({ ok: true, projectRemoved: bare });
});

export default router;
