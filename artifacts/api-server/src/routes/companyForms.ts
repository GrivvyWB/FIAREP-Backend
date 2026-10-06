// FIAREP's own compliance forms: a locked folder. Only an organization the
// platform owner switched "Company Forms" on for (Platform -> Modules) can
// list or download them; client organizations never see them.
import { Router, type IRouter } from "express";
import { access, readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, organizations } from "@workspace/db";
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
