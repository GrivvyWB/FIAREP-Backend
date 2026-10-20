// FIAREP's own compliance forms: a locked folder. Only an organization the
// platform owner switched "Company Forms" on for (Platform -> Modules) can
// list or download them; client organizations never see them.
import { Router, type IRouter } from "express";
import { access, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { canFill, fillForm } from "../lib/formFill";
import { buildingByAddress, clientBuildings, formValuesFor, oathSummons } from "../lib/formPrefill";
import { answersToEnglish, formLines, LANGUAGES, saveLanguage, savedLanguage } from "../lib/userLanguage";

export const COMPANY_FORMS: Array<{ file: string; title: string; group: string; description: string }> = [
  { file: "dob-certificate-of-correction-aeu2.pdf", title: "DOB Certificate of Correction (AEU2)", group: "Violations", description: "Affidavit required for every open DOB / OATH summons — who corrected it, when, cure or stipulation request." },
  { file: "violation-correction-timeline.pdf", title: "Violation Correction Timeline", group: "Violations", description: "HPD / NYCHA milestone tracker: complaint received → inspection → violation → treatment → reinspection → corrected → closed." },
  { file: "vermin-treatment-request.pdf", title: "Vermin Treatment Request", group: "Vermin / Pest", description: "Tenant application for extermination (mice, rats, roaches, bedbugs…) with office-use inspection section." },
  { file: "vermin-complaint-compliance-form.pdf", title: "HPD / NYCHA Vermin Complaint & Compliance Form", group: "Vermin / Pest", description: "Property, tenant, complaint and inspection numbers, extermination company and license, treatment and follow-up dates, closure." },
  { file: "vermin-multi-visit-treatment-log.pdf", title: "Vermin Multi-Visit Treatment Log", group: "Vermin / Pest", description: "Visit-by-visit log: date, technician, treatment type, findings, next visit, supervisor review." },
  { file: "vermin-tenant-acknowledgment.pdf", title: "Vermin Tenant Acknowledgment", group: "Vermin / Pest", description: "Tenant confirms notice received, grants access, follow-up requirements explained." },
  { file: "lead-paint-disclosure-form.pdf", title: "Lead Paint Disclosure & Compliance", group: "Lead", description: "Known lead-based paint, hazard details, inspection, tenant acknowledgment." },
  { file: "lead-remediation-tracking-form.pdf", title: "Lead Remediation Tracking", group: "Lead", description: "Child under 6, XRF and dust-wipe results, remediation log, EPA RRP contractor, clearance exam and violation closure." },
  { file: "lead-hazard-work-log.pdf", title: "Lead Hazard Work Log", group: "Lead", description: "Daily lead hazard control / abatement record with containment and safety verification." },
  { file: "hpd-af6-vermin-affidavit.pdf", title: "Affidavit of Compliance (AF-6)", group: "Vermin / Pest", description: "Mice, cockroaches, and rats infestation violations — work completed after January 19, 2019." },
  { file: "mold-affidavit-of-compliance-af-7.pdf", title: "Affidavit of Compliance (AF-7)", group: "Mold", description: "Mold violations issued on or after January 19, 2019: fewer than 10 units (any class), Class A for 10 or more units, or upgraded Class B." },
  { file: "mold-affidavit-of-compliance-af-8.pdf", title: "Affidavit of Compliance (AF-8)", group: "Mold", description: "Mold violations issued on or after January 19, 2019: 10 or more units, original Class B and C. Attach the assessor's and remediator's affidavits, licenses and DEP filing receipts." },
  { file: "hpd-mold-certificate-of-correction.pdf", title: "Certification of Correction of Violation(s) — Mold (CIV 194)", group: "Mold", description: "10 or more units (Class B and C)." },
  { file: "hpd-affidavit-mold-assessment.pdf", title: "Affidavit of Mold Assessment", group: "Mold", description: "Sworn statement from the mold assessor." },
  { file: "hpd-affidavit-mold-remediation.pdf", title: "Affidavit of Mold Remediation", group: "Mold", description: "Sworn statement from the mold remediator." },
  { file: "tenant-notice-form.pdf", title: "Tenant Notice Form", group: "Tenant notices", description: "Notice of inspection, pest treatment, lead remediation, repairs or maintenance, with entry authorization." },
];

async function formsDir(): Promise<URL> {
  // Dev runs from src/routes; the bundle runs from dist. Both keep the
  // folder beside them (build.mjs copies it into dist).
  for (const candidate of [new URL("./company-forms/", import.meta.url), new URL("../company-forms/", import.meta.url), new URL("../../company-forms/", import.meta.url)]) {
    try { await access(new URL(COMPANY_FORMS[0]!.file, candidate)); return candidate; } catch { /* next */ }
  }
  throw new Error("Company forms folder not found");
}

async function unlocked(tenantId: string): Promise<boolean> {
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = org?.features && typeof org.features === "object" ? (org.features as Record<string, unknown>)["modules"] : null;
  return !!modules && typeof modules === "object" && (modules as Record<string, unknown>)["company-forms"] === true;
}

const router: IRouter = Router();

router.get("/v1/company-forms", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(COMPANY_FORMS);
});

// ── Filled-in forms: saved per organization, only where the folder is unlocked ──
const RECORD_ENTITY = "compliance-forms";
const rowOut = (r: typeof entityRecords.$inferSelect) => ({ id: r.id, formId: String(r.state["formId"] || ""), values: (r.state["values"] as Record<string, unknown>) || {}, label: String(r.state["label"] || ""), createdBy: String(r.state["createdByName"] || ""), updatedBy: String(r.state["updatedByName"] || ""), createdAt: r.createdAt, updatedAt: r.updatedAt });

router.get("/v1/company-forms/records", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  const formId = String(req.query["form"] || "");
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.entity, RECORD_ENTITY), eq(entityRecords.deleted, false),
    ...(formId ? [sql`${entityRecords.state}->>'formId' = ${formId}`] : []),
  )).orderBy(desc(entityRecords.updatedAt)).limit(500);
  res.setHeader("Cache-Control", "no-store");
  res.json(rows.map(rowOut));
});

router.post("/v1/company-forms/records", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const formId = String(b["formId"] || "").trim();
  const values = b["values"] && typeof b["values"] === "object" && !Array.isArray(b["values"]) ? b["values"] as Record<string, unknown> : null;
  if (!formId || !values) { res.status(400).json({ error: "formId and values are required" }); return; }
  if (JSON.stringify(values).length > 200_000) { res.status(400).json({ error: "Form is too large" }); return; }
  const now = new Date();
  const id = typeof b["id"] === "string" && b["id"] ? String(b["id"]) : randomUUID();
  const label = String(b["label"] || "").slice(0, 200);
  const [existing] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.entity, RECORD_ENTITY))).limit(1);
  if (existing) {
    const [row] = await db.update(entityRecords).set({
      state: { ...existing.state, formId, values, label, updatedByName: actor.name, updatedById: actor.id },
      version: sql`${entityRecords.version} + 1`, updatedAt: now,
    }).where(eq(entityRecords.id, id)).returning();
    res.json(rowOut(row!)); return;
  }
  const [row] = await db.insert(entityRecords).values({
    id, tenantId: actor.tenantId, entity: RECORD_ENTITY, development: null,
    state: { formId, values, label, createdByName: actor.name, createdById: actor.id, updatedByName: actor.name, updatedById: actor.id },
    createdBy: actor.id, createdAt: now, updatedAt: now,
  }).returning();
  res.status(201).json(rowOut(row!));
});

router.delete("/v1/company-forms/records/:id", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  await db.update(entityRecords).set({ deleted: true, updatedAt: new Date() })
    .where(and(eq(entityRecords.id, String(req.params.id || "")), eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.entity, RECORD_ENTITY)));
  res.json({ ok: true });
});


// The entry written onto the real form: the government PDF with the values in the blanks.
router.post("/v1/company-forms/fill/:file", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  const form = COMPANY_FORMS.find((f) => f.file === String(req.params.file || ""));
  if (!form || !canFill(form.file)) { res.status(404).json({ error: "This form cannot be filled automatically" }); return; }
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const values = b["values"] && typeof b["values"] === "object" && !Array.isArray(b["values"]) ? b["values"] as Record<string, unknown> : {};
  try {
    const blank = await readFile(new URL(form.file, await formsDir()));
    const filled = await fillForm(form.file, new Uint8Array(blank), values);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="filled-${form.file}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(filled));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not fill the form" });
  }
});

// ── Your language (Settings → Language): the Command Center speaks it; forms show it beside the English ──
router.get("/v1/me/language", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  res.setHeader("Cache-Control", "no-store");
  res.json({ current: await savedLanguage(actor.tenantId, actor.id), languages: LANGUAGES });
});
router.put("/v1/me/language", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const r = await saveLanguage(actor.tenantId, actor.id, String((req.body as { code?: unknown } | undefined)?.code ?? ""));
  if ("error" in r) { res.status(400).json(r); return; }
  res.json(r);
});
router.post("/v1/company-forms/translate", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const lang = await savedLanguage(actor.tenantId, actor.id);
  if (!lang || lang.code === "en") { res.status(400).json({ error: "Pick your language in Settings first." }); return; }
  try {
    if (b["values"] && typeof b["values"] === "object") { const r = await answersToEnglish(b["values"] as Record<string, unknown>); if ("error" in r) { res.status(503).json(r); return; } res.json({ values: r }); return; }
    const lines = Array.isArray(b["lines"]) ? (b["lines"] as unknown[]).map(String) : [];
    const r = await formLines(String(b["formId"] || "form").slice(0, 60), lang.language, lines);
    if ("error" in r) { res.status(503).json(r); return; }
    res.json({ language: lang.language, lines: r });
  } catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Translation failed" }); }
});

// ── Fill a form with its building: "Which building?" on the form, and "Fill AEU2" from an OATH summons ──
router.get("/v1/company-forms/buildings", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(await clientBuildings(actor.tenantId));
});
router.get("/v1/company-forms/prefill/building", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  try {
    const b = await buildingByAddress(actor.tenantId, String(req.query["address"] || ""));
    if ("error" in b) { res.status(404).json(b); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json({ building: b, values: formValuesFor(String(req.query["form"] || ""), b) });
  } catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Could not reach the City's records" }); }
});
router.get("/v1/company-forms/prefill/oath/:ticket", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  try {
    const r = await oathSummons(actor.tenantId, String(req.params["ticket"] || ""));
    if ("error" in r) { res.status(404).json(r); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...r, values: formValuesFor(String(req.query["form"] || "certificate-of-correction"), r.building, r.summons) });
  } catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Could not reach OATH" }); }
});

router.get("/v1/company-forms/:file", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  const form = COMPANY_FORMS.find((f) => f.file === String(req.params.file || ""));
  if (!form) { res.status(404).json({ error: "Form not found" }); return; }
  try {
    const bytes = await readFile(new URL(form.file, await formsDir()));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${form.file}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  } catch {
    res.status(404).json({ error: "Form file is missing on the server" });
  }
});

// ── Fill an affidavit from the violation on file (HPD open data, by violation id) ──
const HPD_VIOLATIONS = "wvxf-dwi5";
const HPD_CONTACTS = "feu5-w2e2";
const COUNTY: Record<string, string> = { BRONX: "Bronx", BROOKLYN: "Kings", MANHATTAN: "New York", QUEENS: "Queens", "STATEN ISLAND": "Richmond" };
const txt = (v: unknown): string => (v == null ? "" : String(v).trim());
function soql(dataset: string, params: Record<string, string>): string {
  const u = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
async function fetchRows(url: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "FIAREP/1.0 forms" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`NYC Open Data returned HTTP ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
const boroName = (v: string) => { const b = v.toUpperCase(); return b === "STATEN ISLAND" ? "Staten Island" : b ? b.charAt(0) + b.slice(1).toLowerCase() : ""; };

router.get("/v1/company-forms/prefill/hpd/:violationId", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (!(await unlocked(actor.tenantId))) { res.status(403).json({ error: "Company forms are not available to this organization" }); return; }
  const id = String(req.params.violationId || "").replace(/\D/g, "");
  if (!id) { res.status(400).json({ error: "A violation number is required" }); return; }
  try {
    const [v] = await fetchRows(soql(HPD_VIOLATIONS, { violationid: id, $limit: "1" }));
    if (!v) { res.status(404).json({ error: `HPD has no violation #${id}` }); return; }
    const registrationId = txt(v["registrationid"]);
    // How many units the building has decides AF-7 (fewer than 10) vs AF-8 (10 or more): DOF valuation first, PLUTO second.
    const bbl = txt(v["bbl"]).replace(/\D/g, "");
    let units = 0; let unitsSource = "";
    if (bbl) {
      try { const r = await fetchRows(soql("8y4t-faws", { $select: "units", $where: `parid='${bbl}'`, $order: "year DESC", $limit: "1" })); const n = Number(r[0]?.["units"] ?? 0); if (n > 0) { units = n; unitsSource = "DOF"; } } catch { /* next */ }
      if (!units) { try { const r = await fetchRows(soql("64uk-42ks", { $select: "unitsres,unitstotal", $where: `bbl=${Number(bbl)}`, $limit: "1" })); const n = Number(r[0]?.["unitsres"] ?? 0) || Number(r[0]?.["unitstotal"] ?? 0); if (n > 0) { units = n; unitsSource = "PLUTO"; } } catch { /* none */ } }
    }
    const contacts = registrationId ? await fetchRows(soql(HPD_CONTACTS, { registrationid: registrationId, $limit: "20" })).catch(() => []) : [];
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
    const borough = boroName(txt(v["boro"]));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      violationId: txt(v["violationid"]), novId: txt(v["novid"]), registrationId,
      class: txt(v["class"]), apartment: txt(v["apartment"]), story: txt(v["story"]),
      address: `${txt(v["housenumber"])} ${txt(v["streetname"])}`.trim(), borough, zip: txt(v["zip"]), county: COUNTY[txt(v["boro"]).toUpperCase()] || borough,
      bbl: txt(v["bbl"]), bin: txt(v["bin"]), units, unitsSource,
      description: txt(v["novdescription"]).replace(/\s+/g, " "), inspectionDate: txt(v["inspectiondate"]).slice(0, 10), novIssuedDate: txt(v["novissueddate"]).slice(0, 10), status: txt(v["currentstatus"]),
      signer: actor.name, company: org?.name || "",
      contacts: contacts.map((c) => ({ type: txt(c["type"]), name: [txt(c["firstname"]), txt(c["lastname"])].filter(Boolean).join(" "), organization: txt(c["corporationname"]), title: txt(c["title"]) })),
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not reach HPD" });
  }
});

export default router;
