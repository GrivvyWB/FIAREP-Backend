// FIAREP's own compliance forms: a locked folder. Only an organization the
// platform owner switched "Company Forms" on for (Platform -> Modules) can
// list or download them; client organizations never see them.
import { Router, type IRouter } from "express";
import { access, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";

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

export default router;
