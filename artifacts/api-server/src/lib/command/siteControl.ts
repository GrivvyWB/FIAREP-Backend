// Command Center → anything on the FIAREP website and Platform Control.
//
// Only on FIAREP's own Command Center, and only for FIAREP's administrators (never a client, never
// other FIAREP staff). The Command Center looks up the site's own endpoints, reads with GET, and
// makes changes through the same endpoints the website buttons use — every change waits for the
// administrator's Face ID approval on the phone.
import { and, eq } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import { actorFromStaff, issuePlatformOwnerSession, revokePlatformOwnerSession, signAccessToken } from "../auth";

type Endpoint = { method: string; path: string; source: string };
let cache: Endpoint[] | null = null;

/** Every endpoint the server answers (walked from the running app). */
async function endpoints(): Promise<Endpoint[]> {
  if (cache) return cache;
  const app = (await import("../../app")).default as unknown as { router?: { stack?: unknown[] }; _router?: { stack?: unknown[] } };
  const out: Endpoint[] = [];
  const walk = (stack: unknown[] | undefined) => {
    for (const layer of stack ?? []) {
      const l = layer as { route?: { path?: unknown; methods?: Record<string, boolean>; stack?: Array<{ handle?: unknown }> }; handle?: { stack?: unknown[] } };
      if (l.route && typeof l.route.path === "string") {
        const methods = Object.keys(l.route.methods ?? {}).filter((m) => l.route!.methods![m]).map((m) => m.toUpperCase());
        const handler = l.route.stack?.[l.route.stack.length - 1]?.handle;
        const source = typeof handler === "function" ? String(handler).slice(0, 700) : "";
        for (const method of methods) out.push({ method, path: l.route.path, source });
      } else if (l.handle && Array.isArray(l.handle.stack)) walk(l.handle.stack);
    }
  };
  walk((app.router ?? app._router)?.stack);
  cache = out.filter((e) => e.path.startsWith("/v1/") && !/^\/v1\/(platform\/)?auth\b/.test(e.path));
  return cache;
}

/** FIAREP's own administrators only. */
async function fiarepAdministrator(tenantId: string, staffId: string) {
  if (tenantId !== "default") return null;
  const [staff] = await db.select().from(staffAccounts).where(and(eq(staffAccounts.id, staffId), eq(staffAccounts.tenantId, "default"))).limit(1);
  return staff && staff.status === "approved" && staff.role === "administrator" ? staff : null;
}
const NOT_ADMIN = { error: "Only FIAREP's administrators can ask the Command Center to change the site." };

export async function siteEndpoints(tenantId: string, staffId: string, words: string) {
  if (!(await fiarepAdministrator(tenantId, staffId))) return NOT_ADMIN;
  const terms = words.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2);
  const all = await endpoints();
  const scored = all.map((e) => ({ e, s: terms.reduce((n, t) => n + (e.path.toLowerCase().includes(t) ? 3 : 0) + (e.source.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((x) => !terms.length || x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12);
  return { total: all.length, endpoints: scored.map(({ e }) => ({ method: e.method, path: e.path, code: e.source })) };
}

/** Call one of the site's endpoints as this administrator (Platform Control endpoints as the platform owner). */
export async function siteCall(tenantId: string, staffId: string, method: string, path: string, body: unknown, client?: string) {
  const admin = await fiarepAdministrator(tenantId, staffId);
  if (!admin) return NOT_ADMIN;
  // Inside a client's account: the call is made as that client's administrator (FIAREP's administrators only).
  let staff = admin;
  if (client?.trim()) {
    const c = await clientByName(client);
    if (!c) return { error: `No client named ${client}.` };
    if ("many" in c) return { error: `Which one: ${c.many.join(", ")}?` };
    const [theirs] = await db.select().from(staffAccounts).where(and(eq(staffAccounts.tenantId, c.id), eq(staffAccounts.role, "administrator"), eq(staffAccounts.status, "approved"))).limit(1);
    if (!theirs) return { error: `${c.name} has no administrator account to act as.` };
    staff = theirs;
  }
  const m = method.toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m)) return { error: "Unknown method." };
  if (!path.startsWith("/v1/") || path.includes("..") || /^\/v1\/(platform\/)?auth\b/.test(path)) return { error: "That is not one of the site's endpoints." };
  const platform = path.startsWith("/v1/platform/");
  const ownerName = process.env["FIAREP_PLATFORM_OWNER_NAME"] ?? "";
  if (platform && !ownerName) return { error: "Platform Control's owner name is not set on the server." };
  const owner = platform ? await issuePlatformOwnerSession(ownerName) : null;
  try {
    const token = owner ? owner.accessToken : signAccessToken(actorFromStaff(staff));
    const r = await fetch(`http://127.0.0.1:${process.env["PORT"]}/api${path}`, {
      method: m, signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${token}`, ...(m === "GET" ? {} : { "Content-Type": "application/json" }) },
      body: m === "GET" || body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* text */ }
    return r.ok ? { ok: true, status: r.status, result: data } : { error: `The site answered ${r.status}: ${typeof data === "object" && data && "error" in data ? String((data as { error: unknown }).error) : text.slice(0, 300)}` };
  } finally {
    if (owner) await revokePlatformOwnerSession(owner.refreshToken).catch(() => undefined);
  }
}

/** "Create a client named John Doe at 151 Blake Ave., Brooklyn, NY 11212 — 5 buildings, 36 units."
 *  Makes the company the same way Platform Control does (with its administrator code and resident
 *  code), sets the units and buildings it is licensed for, sends the code to the person asking, and
 *  prices it from the pricing ladder: the platform, plus the FIAREP plan only when asked. */
export async function createClient(tenantId: string, staffId: string, p: { name: string; contact?: string; email?: string; address?: string; buildings?: number; units?: number; plan?: boolean; buildingAddresses?: string[] }) {
  const staff = await fiarepAdministrator(tenantId, staffId);
  if (!staff) return NOT_ADMIN;
  const name = p.name.trim();
  if (!name) return { error: "I need the client's name." };
  const units = Math.round(Number(p.units) || 0);
  const buildings = Math.round(Number(p.buildings) || 0);
  const made = await siteCall(tenantId, staffId, "POST", "/v1/platform/organizations", {
    name, directorName: (p.contact || name).trim(),
    ...(units > 0 ? { licensedUnits: units } : {}), ...(buildings > 0 ? { propertyLimit: buildings } : {}),
    // Kept on the company so "create the contract" can use them later.
    features: { ...(p.address?.trim() ? { address: p.address.trim() } : {}), ...(p.email?.trim() ? { contactEmail: p.email.trim() } : {}), contactName: (p.contact || name).trim() },
  }) as { ok?: boolean; error?: string; result?: { organization?: { id: string; name: string; features?: Record<string, unknown> }; director?: { name: string; code: string } } };
  if (!made.ok || !made.result?.organization || !made.result.director) return { error: made.error || "The company wasn't created." };
  const org = made.result.organization; const director = made.result.director;
  // Only the building addresses given are added; the rest of the client's DOF portfolio is listed, not added.
  const added = await addBuildings(tenantId, staffId, org.id, p.buildingAddresses ?? []);
  const portfolio = added.added.length ? await portfolioOf(org.id) : null;
  const residentCode = String((org.features?.["residentCode"] as string | undefined) ?? "") || null;
  const { quotePlans } = await import("./sales");
  const q = units > 0 ? await quotePlans(units) : null;
  const price = q && !("error" in q) ? { units: q.units, band: q.band, platform: q.platform, ...(p.plan ? { plan: q.plan } : {}), source: q.source } : null;
  // The code goes to the person who asked, too (their notifications and phone).
  const { notify } = await import("../audit");
  await notify(actorFromStaff(staff), staff.id, `Client code: ${org.name}`, `${director.name} — administrator code ${director.code}${residentCode ? ` · resident code ${residentCode}` : ""} · company ${org.id}`).catch(() => undefined);
  // Emailed too: the client gets their code; FIAREP's mailbox gets the code and the price.
  const { sendEmail } = await import("./mail");
  const { BRAND } = await import("../contracts/contract");
  const mine = (process.env["FIAREP_OWNER_EMAIL"] || BRAND.email).trim();
  const usd = (n?: number) => `$${(n ?? 0).toLocaleString("en-US")}`;
  const priceLines = price ? [
    `Pricing (${price.units} units, ${price.band} band — ${price.source}):`,
    "notSet" in price.platform ? price.platform.notSet : `Platform: ${usd(price.platform.monthly)} a month`,
    ...(price.plan ? ["notSet" in price.plan ? price.plan.notSet : `FIAREP plan: ${usd(price.plan.monthly)} a month`] : []),
  ] : [];
  const sent: string[] = []; const notSent: string[] = [];
  const clientEmail = (p.email || "").trim();
  if (clientEmail) {
    const r = await sendEmail(tenantId, { to: [{ name: director.name, email: clientEmail, from: "" }], cc: [], attachments: [],
      subject: `Your FIAREP code — ${org.name}`,
      body: `Hello ${director.name},\n\nWelcome to FIAREP. Your administrator code is: ${director.code}\n\nOpen the FIAREP app or fiarep.com and sign in with this code.${residentCode ? `

Your residents' code is: ${residentCode}` : ""}\n\nFIAREP\n${BRAND.site}` }, staff.name).catch((e: Error) => ({ error: e.message }));
    ("error" in r ? notSent : sent).push(clientEmail);
  }
  const r2 = await sendEmail(tenantId, { to: [{ name: "FIAREP", email: mine, from: "" }], cc: [], attachments: [],
    subject: `New client: ${org.name} — code ${director.code}`,
    body: [`${org.name} (company ${org.id})${p.address?.trim() ? `
${p.address.trim()}` : ""}`, `Administrator: ${director.name} — code ${director.code}${residentCode ? `
Resident code: ${residentCode}` : ""}`, `Licensed: ${units || "—"} units, ${buildings || "—"} buildings`, ...(priceLines.length ? [priceLines.join("\n")] : []), clientEmail ? `Code emailed to ${clientEmail}.` : "No client email given."].join("\n\n") }, staff.name).catch((e: Error) => ({ error: e.message }));
  ("error" in r2 ? notSent : sent).push(mine);
  return {
    emailedTo: sent, ...(notSent.length ? { emailFailed: notSent } : {}),
    company: org.name, companyId: org.id, address: p.address?.trim() || null,
    buildingsAdded: added.added, ...(added.failed.length ? { buildingsNotAdded: added.failed } : {}),
    dofPortfolio: portfolio,
    administrator: director.name, administratorCode: director.code, residentCode,
    licensedUnits: units || null, buildingsAllowed: buildings || null,
    buildingsNote: "Only the addresses given are added. The rest of the client's DOF portfolio is listed on Platform Control → the company → Buildings, to add any time (or ask me).",
    price,
  };
}

/** Add buildings to a client by street address (the same as Buildings → Add a building by address). */
async function addBuildings(tenantId: string, staffId: string, orgId: string, addresses: string[]) {
  const added: string[] = []; const failed: Array<{ address: string; reason: string }> = [];
  for (const a of addresses.map((x) => String(x || "").trim()).filter((x) => x.length >= 3).slice(0, 50)) {
    const r = await siteCall(tenantId, staffId, "POST", `/v1/platform/organizations/${encodeURIComponent(orgId)}/properties`, { displayAddress: a }) as { ok?: boolean; error?: string; result?: { displayAddress?: string } };
    if (r.ok) added.push(r.result?.displayAddress || a); else failed.push({ address: a, reason: r.error || "Not added" });
  }
  return { added, failed };
}

/** The client's DOF portfolio (owner name taken from their first building): which buildings are added, which are not. */
async function portfolioOf(orgId: string) {
  const { organizations, organizationProperties } = await import("@workspace/db");
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const owner = String(((org?.features ?? {}) as Record<string, unknown>)["dofOwner"] ?? "");
  if (!owner) return { owner: null, note: "No DOF owner found yet — add one of the client's NYC buildings by address first." };
  const { dofBuildingsByOwner } = await import("../dofCharges");
  const { year, buildings } = await dofBuildingsByOwner(owner);
  const have = new Set((await db.select({ bbl: organizationProperties.bbl }).from(organizationProperties).where(eq(organizationProperties.organizationId, orgId))).map((x) => x.bbl).filter(Boolean) as string[]);
  const notAdded = buildings.filter((b) => !have.has(b.bbl));
  return {
    owner, rollYear: year, total: buildings.length, added: buildings.length - notAdded.length,
    notAdded: notAdded.length, notAddedUnits: notAdded.reduce((n, b) => n + b.units, 0),
    list: notAdded.slice(0, 60).map((b) => `${b.displayAddress} · ${b.units} units`),
    source: "NYC Department of Finance assessment roll (8y4t-faws)",
  };
}

async function clientByName(name: string) {
  const { organizations } = await import("@workspace/db");
  const { ilike } = await import("drizzle-orm");
  const rows = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(ilike(organizations.name, `%${name.trim()}%`)).limit(5);
  const exact = rows.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());
  return exact ?? (rows.length === 1 ? rows[0]! : rows.length ? { many: rows.map((o) => o.name) } : null);
}

export async function clientPortfolio(tenantId: string, staffId: string, client: string) {
  if (!(await fiarepAdministrator(tenantId, staffId))) return NOT_ADMIN;
  const c = await clientByName(client);
  if (!c) return { error: `No client named ${client}.` };
  if ("many" in c) return { error: `Which one: ${c.many.join(", ")}?` };
  return { client: c.name, ...(await portfolioOf(c.id)) };
}

export async function addClientBuildings(tenantId: string, staffId: string, client: string, addresses: string[]) {
  if (!(await fiarepAdministrator(tenantId, staffId))) return NOT_ADMIN;
  const c = await clientByName(client);
  if (!c) return { error: `No client named ${client}.` };
  if ("many" in c) return { error: `Which one: ${c.many.join(", ")}?` };
  const r = await addBuildings(tenantId, staffId, c.id, addresses);
  return { client: c.name, added: r.added, ...(r.failed.length ? { notAdded: r.failed } : {}) };
}

/** "Go ahead and create the contract": the client's agreement from what's on the company (units, the
 *  buildings added, who signs, their email), signed by FIAREP with the owner's saved signature, and
 *  sent to the client to agree and sign on their phone or computer. */
type ContractAsk = { client: string; kind?: string; pilot?: boolean; email?: string; contact?: string; title?: string; termMonths?: number; monthly?: number; units?: number };
export async function contractForClient(tenantId: string, staffId: string, p: ContractAsk) {
  const staff = await fiarepAdministrator(tenantId, staffId);
  if (!staff) return NOT_ADMIN;
  return clientContract(p, staff.name);
}

/** The same, from Platform Control (the owner). */
export async function clientContract(p: ContractAsk, by: string) {
  const tenantId = "default";
  const c = await clientByName(p.client);
  if (!c) return { error: `No client named ${p.client}.` };
  if ("many" in c) return { error: `Which one: ${c.many.join(", ")}?` };
  const { organizations, organizationProperties } = await import("@workspace/db");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, c.id)).limit(1);
  if (!org) return { error: "Client not found." };
  const f = (org.features ?? {}) as Record<string, unknown>;
  const email = (p.email || String(f["contactEmail"] ?? "")).trim();
  if (!email.includes("@")) return { error: `I need ${org.name}'s email to send the contract.` };
  const props = await db.select().from(organizationProperties).where(eq(organizationProperties.organizationId, org.id));
  const buildingUnits = props.reduce((n, b) => n + (b.units || 0), 0);
  const units = (p.units && p.units > 0 ? Math.round(p.units) : 0) || org.licensedUnits || buildingUnits;
  if (!units) return { error: `How many units does ${org.name} have?` };
  const [director] = await db.select({ name: staffAccounts.name }).from(staffAccounts).where(and(eq(staffAccounts.tenantId, org.id), eq(staffAccounts.role, "administrator"))).limit(1);
  const contact = (p.contact || String(f["contactName"] ?? "") || director?.name || org.name).trim();
  const { buildContractHtml, contractNumber, monthlyFee } = await import("../contracts/contract");
  const { setBands } = await import("../contracts/bands");
  const { savedBands } = await import("./sales");
  setBands(await savedBands());
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const input = {
    kind: (p.kind === "fiarep" ? "fiarep" : "platform") as "fiarep" | "platform", number: contractNumber(), date: today,
    fiarepSigner: "Tim Winn, Managing Member", fiarepEntity: "Grivvy Com LLC d/b/a FIAREP",
    client: { company: org.name, contact, title: (p.title || "").trim(), address: String(f["address"] ?? ""), email, phone: "" },
    buildings: props.map((b) => ({ name: b.development || "", address: b.displayAddress, units: b.units || 0 })),
    units, flatFee: 0, pilot: p.pilot === true, startDate: today, termMonths: Math.min(Math.max(Math.round(Number(p.termMonths) || 12), 1), 120),
    scope: [], engineering: null, expediter: null, notes: "",
    monthlyOverride: p.monthly && p.monthly > 0 ? Math.round(p.monthly * 100) / 100 : null,
  };
  const fee = monthlyFee(input);
  if (!fee.monthly) return { error: `${fee.basis}. Set it there, then ask again.` };
  const { startSigning } = await import("../contracts/signing");
  const started = await startSigning(buildContractHtml(input), { number: input.number, company: org.name, contact, email, kind: input.kind, monthly: fee.monthly, orgId: org.id }, by);
  if ("error" in started) return started;
  const { sendEmail } = await import("./mail");
  const { BRAND } = await import("../contracts/contract");
  const mine = (process.env["FIAREP_OWNER_EMAIL"] || BRAND.email).trim();
  const body = `Hello ${contact},\n\nHere is your FIAREP agreement (${input.number}) for ${org.name}: ${units.toLocaleString("en-US")} units, $${fee.monthly.toLocaleString("en-US")} a month. FIAREP has signed it.\n\nOpen this link to read it, tap "I agree" and sign:\n${started.link}\n\nFIAREP\n${BRAND.site}`;
  const sent = await sendEmail(tenantId, { to: [{ name: contact, email, from: "" }], cc: mine && mine !== email ? [{ name: "FIAREP", email: mine, from: "" }] : [], attachments: [], subject: `FIAREP agreement ${input.number} — please sign`, body }, by).catch((e: Error) => ({ error: e.message }));
  return {
    company: org.name, number: input.number, kind: input.kind, units, buildings: props.length, monthly: fee.monthly, basis: fee.basis, setupFee: fee.setup,
    signedByFiarep: true, signingLink: started.link, emailedTo: "error" in sent ? null : email, ...("error" in sent ? { emailError: sent.error } : {}),
  };
}

/** The job titles said out loud, and the account each one gets. */
function titleAndRole(said: string): { position: string; role: string } {
  const t = said.trim().toLowerCase().replace(/^(an?|the)\s+/, "");
  if (/^tech(nician)?s?$/.test(t)) return { position: "Technician", role: "inspector" };
  if (/maintenance/.test(t) && !/supervisor/.test(t)) return { position: "Maintenance Worker", role: "worker" };
  if (/^c\.?p\.?m\.?$/.test(t)) return { position: "CPM", role: "inspector" };
  if (/^inspectors?$/.test(t)) return { position: "Inspector", role: "inspector" };
  if (/^admin(istrator)?$/.test(t)) return { position: "Administrator", role: "administrator" };
  if (/(borough|bureau)\s+(chief|director)/.test(t)) return { position: "Borough Director", role: "administrator" };
  const position = said.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const management = /supervisor|superintendent|director|property manager|housing assistant/i.test(position);
  return { position, role: management ? "management" : "worker" };
}

/** Add a person to a client right there, with their sign-in code — no HR approval. */
export async function addClientUser(tenantId: string, staffId: string, p: { client: string; name: string; title: string; development?: string; email?: string }) {
  const me = await fiarepAdministrator(tenantId, staffId);
  if (!me) return NOT_ADMIN;
  const c = await clientByName(p.client);
  if (!c) return { error: `No client named ${p.client}.` };
  if ("many" in c) return { error: `Which one: ${c.many.join(", ")}?` };
  const name = p.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.length < 2) return { error: "I need the person's full name." };
  const { position, role } = titleAndRole(p.title || "worker");
  const { organizations } = await import("@workspace/db");
  const { count, sql } = await import("drizzle-orm");
  const { allocateStaffCode } = await import("../staffCodes");
  const { randomUUID } = await import("node:crypto");
  try {
    const made = await db.transaction(async (tx) => {
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, c.id)).limit(1);
      if (!org) throw Object.assign(new Error("Client not found."), { status: 404 });
      if (org.staffLimit != null) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-limit:${org.id}`}))`);
        const [{ value }] = await tx.select({ value: count() }).from(staffAccounts).where(eq(staffAccounts.tenantId, org.id));
        if (Number(value) >= org.staffLimit) throw Object.assign(new Error(`${org.name} is at its limit of ${org.staffLimit} people. Raise it in Platform Control first.`), { status: 403 });
      }
      const code = await allocateStaffCode(tx, org.id, name);
      const [row] = await tx.insert(staffAccounts).values({
        id: randomUUID(), tenantId: org.id, name, code, role, position, status: "approved",
        developments: p.development?.trim() ? [p.development.trim()] : [], issuerName: `${me.name} (Command Center)`,
      }).returning();
      return { org, row: row!, code };
    });
    // The code goes to the person who asked (notifications and phone), FIAREP's mailbox, and the new person's email if given.
    const { notify } = await import("../audit");
    await notify(actorFromStaff(me), me.id, `New user: ${name} (${made.org.name})`, `${position} — code ${made.code} · company ${made.org.id}`).catch(() => undefined);
    const { sendEmail } = await import("./mail");
    const { BRAND } = await import("../contracts/contract");
    const mine = (process.env["FIAREP_OWNER_EMAIL"] || BRAND.email).trim();
    const how = `Sign in on the FIAREP app or fiarep.com with:\nCompany: ${made.org.id}\nName: ${name}\nCode: ${made.code}`;
    const emailed: string[] = [];
    if (p.email?.includes("@")) {
      const r = await sendEmail(tenantId, { to: [{ name, email: p.email.trim(), from: "" }], cc: [], attachments: [], subject: `Your FIAREP sign-in — ${made.org.name}`, body: `Hello ${name},\n\nYou've been added to ${made.org.name} on FIAREP as ${position}.\n\n${how}\n\nFIAREP\n${BRAND.site}` }, me.name).catch(() => ({ error: "not sent" }));
      if (!("error" in r)) emailed.push(p.email.trim());
    }
    const r2 = await sendEmail(tenantId, { to: [{ name: "FIAREP", email: mine, from: "" }], cc: [], attachments: [], subject: `New user at ${made.org.name}: ${name} — code ${made.code}`, body: `${name} — ${position} at ${made.org.name}.\n\n${how}` }, me.name).catch(() => ({ error: "not sent" }));
    if (!("error" in r2)) emailed.push(mine);
    return { client: made.org.name, companyId: made.org.id, name, title: position, account: role, code: made.code, development: p.development?.trim() || null, emailedTo: emailed, hrApproval: "skipped (added by a FIAREP administrator)" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The person wasn't added." };
  }
}
