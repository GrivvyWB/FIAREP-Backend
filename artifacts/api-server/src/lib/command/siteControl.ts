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
export async function siteCall(tenantId: string, staffId: string, method: string, path: string, body: unknown) {
  const staff = await fiarepAdministrator(tenantId, staffId);
  if (!staff) return NOT_ADMIN;
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
export async function createClient(tenantId: string, staffId: string, p: { name: string; contact?: string; address?: string; buildings?: number; units?: number; plan?: boolean }) {
  const staff = await fiarepAdministrator(tenantId, staffId);
  if (!staff) return NOT_ADMIN;
  const name = p.name.trim();
  if (!name) return { error: "I need the client's name." };
  const units = Math.round(Number(p.units) || 0);
  const buildings = Math.round(Number(p.buildings) || 0);
  const made = await siteCall(tenantId, staffId, "POST", "/v1/platform/organizations", {
    name, directorName: (p.contact || name).trim(),
    ...(units > 0 ? { licensedUnits: units } : {}), ...(buildings > 0 ? { propertyLimit: buildings } : {}),
    ...(p.address?.trim() ? { features: { address: p.address.trim() } } : {}),
  }) as { ok?: boolean; error?: string; result?: { organization?: { id: string; name: string; features?: Record<string, unknown> }; director?: { name: string; code: string } } };
  if (!made.ok || !made.result?.organization || !made.result.director) return { error: made.error || "The company wasn't created." };
  const org = made.result.organization; const director = made.result.director;
  const residentCode = String((org.features?.["residentCode"] as string | undefined) ?? "") || null;
  const { quotePlans } = await import("./sales");
  const q = units > 0 ? await quotePlans(units) : null;
  const price = q && !("error" in q) ? { units: q.units, band: q.band, platform: q.platform, ...(p.plan ? { plan: q.plan } : {}), source: q.source } : null;
  // The code goes to the person who asked, too (their notifications and phone).
  const { notify } = await import("../audit");
  await notify(actorFromStaff(staff), staff.id, `Client code: ${org.name}`, `${director.name} — administrator code ${director.code}${residentCode ? ` · resident code ${residentCode}` : ""} · company ${org.id}`).catch(() => undefined);
  return {
    company: org.name, companyId: org.id, address: p.address?.trim() || null,
    administrator: director.name, administratorCode: director.code, residentCode,
    licensedUnits: units || null, buildingsAllowed: buildings || null,
    buildingsNote: "Each building is added with its street address in Platform Control → the company → Buildings (or tell me the addresses).",
    price,
  };
}
