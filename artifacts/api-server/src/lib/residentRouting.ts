// Which company a resident's complaint belongs to.
//
// Several companies (NYCHA, HPD, a private manager…) share one FIAREP
// server. A complaint filed from the public form has to land with the one
// company that manages that building, or its supervisors never see it.
//
// Order of decision:
//   1. the building address is on a company's property list → that company;
//   2. the resident typed the company's 6-digit resident code → that company;
//   3. exactly one licensed company covers the development (its configured
//      developments, its staff's developments, or its properties) → it;
//   4. only one licensed customer exists → it;
//   5. otherwise the resident is asked for the company's resident code.
import { and, eq } from "drizzle-orm";
import { db, organizationProperties, organizations, staffAccounts } from "@workspace/db";
import { evaluateLicense, licenseAllows } from "./auth";
import { getConfiguredDevelopmentNames } from "./organizationDevelopments";

const norm = (value: unknown): string => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function residentCodeOf(features: unknown): string {
  if (!features || typeof features !== "object" || Array.isArray(features)) return "";
  const code = (features as Record<string, unknown>)["residentCode"];
  return typeof code === "string" && /^\d{6}$/.test(code) ? code : "";
}

export function withResidentCode(features: unknown, code: string): Record<string, unknown> {
  const existing = features && typeof features === "object" && !Array.isArray(features)
    ? { ...(features as Record<string, unknown>) }
    : {};
  existing["residentCode"] = code;
  return existing;
}

type Org = typeof organizations.$inferSelect;

async function licensedOrganizations(): Promise<Org[]> {
  const rows = await db.select().from(organizations);
  const out: Org[] = [];
  for (const org of rows) {
    const license = await evaluateLicense(org.id);
    if (licenseAllows(license, org.id)) out.push(license ?? org);
  }
  return out;
}

/** A 6-digit resident code no other company has. */
export async function newResidentCode(): Promise<string> {
  const rows = await db.select({ features: organizations.features }).from(organizations);
  const taken = new Set(rows.map((r) => residentCodeOf(r.features)).filter(Boolean));
  for (let i = 0; i < 50; i++) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    if (!taken.has(code)) return code;
  }
  throw new Error("Could not pick a resident code");
}

/** Every company has a resident code; issue one the first time it is needed. */
export async function ensureResidentCode(org: Org): Promise<string> {
  const existing = residentCodeOf(org.features);
  if (existing) return existing;
  const code = await newResidentCode();
  await db.update(organizations)
    .set({ features: withResidentCode(org.features, code), updatedAt: new Date() })
    .where(eq(organizations.id, org.id));
  return code;
}

/** The company behind a resident code, for the resident's phone to confirm it. */
export async function organizationForResidentCode(code: string): Promise<{ id: string; name: string } | null> {
  const clean = code.replace(/\D/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const match = (await licensedOrganizations()).find((org) => residentCodeOf(org.features) === clean);
  return match ? { id: match.id, name: match.name } : null;
}

/** Companies whose name matches what the resident typed, with their codes. */
export async function residentCompaniesNamed(query: string): Promise<Array<{ code: string; organizationName: string }>> {
  const q = norm(query).replace(/[.,'"]/g, "");
  if (q.length < 2) return [];
  const words = q.split(" ").filter(Boolean);
  const out: Array<{ code: string; organizationName: string }> = [];
  for (const org of await licensedOrganizations()) {
    if (org.id === "default") continue;
    const name = norm(org.name).replace(/[.,'"]/g, "");
    const hit = name === q || name.includes(q) || words.every((w) => name.includes(w));
    if (!hit) continue;
    out.push({ code: await ensureResidentCode(org), organizationName: org.name });
  }
  // An exact name wins outright.
  const exact = out.filter((o) => norm(o.organizationName).replace(/[.,'"]/g, "") === q);
  return exact.length === 1 ? exact : out;
}

async function coversDevelopment(org: Org, development: string): Promise<boolean> {
  const wanted = norm(development);
  if (!wanted) return false;
  const configured = getConfiguredDevelopmentNames(org.features);
  if (configured?.some((name) => norm(name) === wanted)) return true;
  const staff = await db.select({ developments: staffAccounts.developments })
    .from(staffAccounts).where(eq(staffAccounts.tenantId, org.id));
  if (staff.some((s) => (s.developments || []).some((d) => norm(d) === wanted))) return true;
  const props = await db.select({ development: organizationProperties.development })
    .from(organizationProperties)
    .where(and(eq(organizationProperties.organizationId, org.id), eq(organizationProperties.active, true)));
  return props.some((p) => norm(p.development) === wanted);
}

export type ResidentOrgResolution =
  | { ok: true; tenantId: string; how: "code" | "development" | "only-customer" | "default" }
  | { ok: false; status: number; error: string; needsCompanyCode?: boolean };

export async function resolveResidentOrganization(input: { development: string; companyCode: string }): Promise<ResidentOrgResolution> {
  const code = input.companyCode.replace(/\D/g, "");
  const licensed = await licensedOrganizations();
  if (code) {
    const match = licensed.find((org) => residentCodeOf(org.features) === code);
    if (!match) return { ok: false, status: 400, error: "That resident code isn't recognized. Check the 6-digit code from your management office.", needsCompanyCode: true };
    return { ok: true, tenantId: match.id, how: "code" };
  }
  const covering: Org[] = [];
  for (const org of licensed) if (await coversDevelopment(org, input.development)) covering.push(org);
  if (covering.length === 1) return { ok: true, tenantId: covering[0]!.id, how: "development" };
  if (covering.length > 1) {
    return {
      ok: false, status: 400, needsCompanyCode: true,
      error: `More than one company manages ${input.development.trim()}. Enter your management company's 6-digit resident code so this reaches the right office.`,
    };
  }
  const customers = licensed.filter((org) => org.id !== "default");
  if (customers.length === 1) return { ok: true, tenantId: customers[0]!.id, how: "only-customer" };
  if (customers.length === 0) return { ok: true, tenantId: "default", how: "default" };
  return {
    ok: false, status: 400, needsCompanyCode: true,
    error: `No company on this system lists ${input.development.trim()} yet. Enter your management company's 6-digit resident code.`,
  };
}
