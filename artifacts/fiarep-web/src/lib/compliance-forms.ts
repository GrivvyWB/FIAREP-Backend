// FIAREP's compliance forms, as fillable website forms. Each definition
// mirrors the paper/PDF version; entries are saved per organization and can
// be printed. The blank PDF stays downloadable from the locked folder.

export type Field = {
  key: string; label: string;
  type?: "text" | "date" | "textarea" | "checkbox" | "select" | "number";
  options?: string[]; full?: boolean;
};
export type Column = { key: string; label: string; type?: "text" | "date" | "number" };
export type Section = { title: string; fields?: Field[]; table?: { key: string; columns: Column[]; rows: number }; checks?: Field[]; note?: string };
export type FormDef = { id: string; title: string; subtitle: string; group: string; pdf: string; titleKeys: string[]; sections: Section[] };

const t = (key: string, label: string, full = false): Field => ({ key, label, full });
const d = (key: string, label: string): Field => ({ key, label, type: "date" });
const ta = (key: string, label: string): Field => ({ key, label, type: "textarea", full: true });
const cb = (key: string, label: string): Field => ({ key, label, type: "checkbox" });
const yn = (key: string, label: string): Field => ({ key, label, type: "select", options: ["", "Yes", "No"] });

export const COMPLIANCE_FORMS: FormDef[] = [
  {
    id: "certificate-of-correction", group: "Violations", pdf: "dob-certificate-of-correction-aeu2.pdf",
    title: "DOB Certificate of Correction (AEU2)", subtitle: "Affidavit required for all open Department of Buildings OATH summonses",
    titleKeys: ["summonsNumber", "address"],
    sections: [
      { title: "1. Violation information", fields: [
        t("summonsNumber", "Summons number"), t("address", "Place of occurrence (house number and street)"), t("boroughZip", "Borough, State, Zip"),
        t("certifier", "I, (name of an individual, not a business)"),
        { key: "certifierRole", label: "I am the", type: "select", options: ["", "Respondent named on the violation", "Officer, Director, Partner or Managing Member of the named respondent", "Owner of property but not the named respondent (attach deed)", "Current mortgagee (attach proof + notarized authorization)", "Other agent (attach notarized authorization letter)"], full: true },
        t("mailingAddress", "Certifier's mailing address", true),
      ] },
      { title: "2. Person who performed work", fields: [
        d("completedOn", "Work completed on"),
        { key: "performedBy", label: "Performed by", type: "select", options: ["", "Myself", "My employee", "Contractor", "Licensed professional"] },
        t("workerName", "Name of the person who performed the work"), t("workerCompany", "Company"), t("workerAddress", "Address", true), t("licenseNumber", "License or registration number"),
      ], note: "A notarized Statement in Support (AEU20) and documentary proof of correction must also be provided. Label all photographs with date, location and summons number; Before and After as such." },
      { title: "3. Penalty waivers & reductions", fields: [
        cb("cure", "CURE — I admit the violation(s); the cure date is:"), d("cureDate", "Cure date"),
        cb("stipulation", "STIPULATION — I admit the violation(s); the compliance due date is:"), d("stipulationDate", "Stipulation compliance due date"),
      ] },
      { title: "4. Statement of signature", fields: [t("signerName", "Name (print)"), t("notaryCounty", "Notarization — State of New York, County of"), d("signedOn", "Date")] },
    ],
  },
  {
    id: "violation-timeline", group: "Violations", pdf: "violation-correction-timeline.pdf",
    title: "Violation Correction Timeline", subtitle: "HPD / NYCHA compliance milestone tracking",
    titleKeys: ["property", "violationNumber"],
    sections: [
      { title: "Case", fields: [t("property", "Property"), t("unit", "Apartment / unit"), t("violationNumber", "Violation number"), t("complaintNumber", "Complaint number")] },
      { title: "Milestones", table: { key: "milestones", rows: 8, columns: [{ key: "milestone", label: "Milestone" }, { key: "target", label: "Target date", type: "date" }, { key: "completed", label: "Completed date", type: "date" }, { key: "party", label: "Responsible party" }, { key: "status", label: "Status" }] } },
      { title: "Compliance notes", fields: [ta("notes", "Notes")] },
    ],
  },
  {
    id: "vermin-request", group: "Vermin / Pest", pdf: "vermin-treatment-request.pdf",
    title: "Vermin Treatment Request", subtitle: "Application — NYCHA, Section 8, public or municipal housing",
    titleKeys: ["applicant", "unit"],
    sections: [
      { title: "Applicant", fields: [t("applicant", "Applicant name"), t("phone", "Phone"), t("email", "Email"), t("unit", "Apartment / unit"), t("property", "Property name"), t("landlord", "Landlord / manager address", true)] },
      { title: "Problem", checks: [cb("mice", "Mice"), cb("rats", "Rats"), cb("roaches", "Roaches"), cb("bedbugs", "Bedbugs"), cb("ants", "Ants"), cb("fleas", "Fleas"), cb("other", "Other")],
        fields: [ta("description", "Description of problem"), d("firstObserved", "First observed"), d("mostRecent", "Most recent occurrence"), yn("previouslyReported", "Previously reported?"), t("tenantSignature", "Tenant signature (type name)"), d("signedOn", "Date")] },
      { title: "Office use only", fields: [d("inspectionDate", "Inspection date"), t("inspector", "Inspector"), ta("actionTaken", "Action taken"), d("followUpDate", "Follow-up date")] },
    ],
  },
  {
    id: "vermin-compliance", group: "Vermin / Pest", pdf: "vermin-complaint-compliance-form.pdf",
    title: "HPD / NYCHA Vermin Complaint & Compliance Form", subtitle: "Housing compliance and extermination tracking",
    titleKeys: ["tenantName", "unit"],
    sections: [
      { title: "Property & tenant information", fields: [t("tenantName", "Tenant name"), t("phone", "Phone"), t("email", "Email"), t("unit", "Apartment / unit"), t("address", "Property address", true), t("development", "Development name"), t("agency", "Housing authority / agency"), t("borough", "Borough / county"), t("registration", "Building registration number"), t("hpdComplaint", "HPD complaint number"), t("inspectionRequest", "Inspection request number"), ta("conditions", "Conditions description")] },
      { title: "Inspection & compliance tracking", fields: [d("inspectionDate", "Inspection date"), t("inspectorId", "Inspector ID"), t("violationNumber", "Violation number"), t("exterminator", "Extermination company"), t("license", "License number"), d("treatmentDate", "Treatment date"), d("followUpDate", "Follow-up date")] },
      { title: "Compliance verification & closure", fields: [d("reinspectionDate", "Reinspection date"), t("complianceStatus", "Compliance status"), t("inspectorSignature", "Inspector signature"), d("verificationDate", "Verification date"), ta("finalNotes", "Final notes")] },
    ],
  },
  {
    id: "vermin-treatment-log", group: "Vermin / Pest", pdf: "vermin-multi-visit-treatment-log.pdf",
    title: "Vermin Multi-Visit Treatment Log", subtitle: "HPD / NYCHA — visit-by-visit extermination record",
    titleKeys: ["property", "unit"],
    sections: [
      { title: "Location", fields: [t("property", "Property"), t("unit", "Apartment / unit")] },
      { title: "Treatment log", table: { key: "visits", rows: 6, columns: [{ key: "date", label: "Visit date", type: "date" }, { key: "technician", label: "Technician" }, { key: "treatment", label: "Treatment type" }, { key: "findings", label: "Findings" }, { key: "next", label: "Next visit", type: "date" }] } },
      { title: "Supervisor review", fields: [ta("review", "Supervisor review notes")] },
    ],
  },
  {
    id: "vermin-acknowledgment", group: "Vermin / Pest", pdf: "vermin-tenant-acknowledgment.pdf",
    title: "Vermin Tenant Acknowledgment", subtitle: "HPD / NYCHA vermin compliance — tenant acknowledgment addendum",
    titleKeys: ["tenantName", "unit"],
    sections: [
      { title: "Tenant", fields: [t("tenantName", "Tenant name"), t("unit", "Apartment / unit"), d("notificationDate", "Notification date"), d("treatmentDate", "Treatment date received")],
        note: "I acknowledge that I have been notified of extermination services, granted access as required, and understand the follow-up requirements.",
        checks: [cb("receipt", "Tenant acknowledges receipt of notice"), cb("access", "Tenant grants access for treatment and inspection"), cb("followUp", "Follow-up treatment requirements explained")] },
      { title: "Signatures", fields: [t("tenantSignature", "Tenant signature (typed)"), d("tenantDate", "Date"), t("representative", "Management representative"), d("representativeDate", "Representative date")] },
    ],
  },
  {
    id: "lead-disclosure", group: "Lead", pdf: "lead-paint-disclosure-form.pdf",
    title: "Lead Paint Disclosure & Compliance", subtitle: "Residential property lead hazard documentation",
    titleKeys: ["address", "unit"],
    sections: [
      { title: "Property", fields: [t("address", "Property address", true), t("owner", "Owner / landlord"), t("tenant", "Tenant"), t("unit", "Unit number"), t("yearBuilt", "Year built"), yn("leadPresent", "Known lead-based paint present"), ta("hazardDetails", "Lead hazard details")] },
      { title: "Inspection", fields: [d("inspectionDate", "Inspection date"), t("inspector", "Inspector"), t("tenantSignature", "Tenant acknowledgment signature (typed)"), d("signedOn", "Date")] },
    ],
  },
  {
    id: "lead-remediation", group: "Lead", pdf: "lead-remediation-tracking-form.pdf",
    title: "Lead Remediation Tracking", subtitle: "Lead hazard investigation, abatement and clearance tracking",
    titleKeys: ["address", "unit"],
    sections: [
      { title: "Unit", fields: [t("address", "Property address", true), t("unit", "Unit number"), t("yearBuilt", "Year built"), t("hpdViolation", "HPD violation number"), yn("childUnder6", "Child under age 6 resides in unit")] },
      { title: "Inspection and testing results", fields: [ta("xrf", "XRF test results"), ta("dustWipe", "Dust wipe sample results")] },
      { title: "Remediation activity log", table: { key: "activity", rows: 6, columns: [{ key: "date", label: "Date", type: "date" }, { key: "location", label: "Location" }, { key: "action", label: "Corrective action" }, { key: "contractor", label: "Contractor" }, { key: "status", label: "Status" }] } },
      { title: "EPA RRP contractor", fields: [t("rrpContractor", "Contractor"), t("rrpCertification", "Certification number"), t("rrpPhone", "Phone")] },
      { title: "Clearance examination & closure", fields: [d("clearanceDate", "Clearance exam date"), t("examiner", "Examiner"), t("clearanceResult", "Clearance result"), d("closureDate", "Violation closure date"), ta("finalNotes", "Final compliance notes")] },
    ],
  },
  {
    id: "lead-work-log", group: "Lead", pdf: "lead-hazard-work-log.pdf",
    title: "Lead Hazard Work Log", subtitle: "Daily lead hazard control, repair and abatement activity record",
    titleKeys: ["address", "logDate"],
    sections: [
      { title: "Property", fields: [t("address", "Property address", true), d("logDate", "Log date")] },
      { title: "Work performed", table: { key: "work", rows: 6, columns: [{ key: "date", label: "Date", type: "date" }, { key: "area", label: "Work area" }, { key: "performed", label: "Work performed" }, { key: "worker", label: "Worker" }, { key: "hours", label: "Hours", type: "number" }, { key: "supervisor", label: "Supervisor" }] } },
      { title: "Safety & containment verification", checks: [cb("containment", "Containment installed"), cb("signs", "Warning signs posted"), cb("dust", "Dust control measures used"), cb("waste", "Waste properly bagged"), cb("cleaned", "Area cleaned daily"), cb("ppe", "PPE used")], fields: [ta("safetyNotes", "Daily safety notes"), t("supervisorCert", "Supervisor certification (name)"), d("certDate", "Date")] },
    ],
  },
  {
    id: "tenant-notice", group: "Tenant notices", pdf: "tenant-notice-form.pdf",
    title: "Tenant Notice Form", subtitle: "Notice of inspection, repair, treatment, or remediation",
    titleKeys: ["tenantName", "unit"],
    sections: [
      { title: "Notice", fields: [t("address", "Property address", true), t("tenantName", "Tenant name"), t("unit", "Apartment / unit"), d("noticeDate", "Notice date"), d("scheduledDate", "Scheduled date")],
        checks: [cb("inspection", "Inspection"), cb("pest", "Pest treatment"), cb("lead", "Lead remediation"), cb("repairs", "Repairs"), cb("maintenance", "Maintenance"), cb("other", "Other")] },
      { title: "Details", fields: [ta("details", "Notice details"), ta("entry", "Entry authorization and acknowledgment")] },
      { title: "Signatures", fields: [t("tenantSignature", "Tenant signature (typed)"), d("tenantDate", "Date"), t("representative", "Management representative"), d("representativeDate", "Date")] },
    ],
  },
];

export const MILESTONES = ["Complaint received", "Inspection completed", "Violation issued", "Initial treatment", "Follow-up treatment", "Reinspection", "Violation corrected", "Case closed"];

export function formById(id: string): FormDef | undefined {
  return COMPLIANCE_FORMS.find((f) => f.id === id);
}

/** A one-line label for a saved entry, from the form's title keys. */
export function entryLabel(def: FormDef, values: Record<string, unknown>): string {
  const parts = def.titleKeys.map((k) => String(values[k] ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : "Untitled";
}
