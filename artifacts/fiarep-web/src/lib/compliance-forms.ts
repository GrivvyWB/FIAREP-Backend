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
    id: "af6-vermin", group: "Vermin / Pest", pdf: "hpd-af6-vermin-affidavit.pdf",
    title: "Affidavit of Compliance (AF-6)", subtitle: "Mice, cockroaches, and rats infestation violations — work completed after January 19, 2019",
    titleKeys: ["violationNumbers", "address"],
    sections: [
      { title: "Violation", fields: [t("violationNumbers", "Violation Number(s)", true), t("apartment", "Apt #"), t("county", "County of (State of New York)")] },
      { title: "Affidavit", fields: [t("signerName", "I, (type or print name)", true), t("address", "Entire building address, including borough", true), t("registrationNumber", "Property Registration number")],
        note: "1. That I am over twenty-one years of age and am the registered owner and/or managing agent of the subject premises. 2. That I have read HPD's \"Guide to Local Law 55 of 2018 Integrated Pest Management Practices\" and am aware of the work practices required to eliminate mice, cockroaches, and rat infestation safely and in accordance with all applicable laws and rules. 3. That the work undertaken to correct the above-referenced violation(s) was performed in accordance with the required integrated pest management and other work practices. 4. That I have examined the area(s) identified in the above-referenced violation number(s), to my knowledge such violation(s) whose number(s) I have listed were corrected in accordance with the integrated pest management and work practices in Administrative Code §27-2017.8 and 28 RCNY §54-04(a). 5. That if pesticides were used to abate the presence of mice, cockroaches, and rat infestations, a certified commercial pesticide applicator was used in accordance with New York State Environmental Conservation Law (ECL Article 33 §33-0905)." },
      { title: "Sworn to me this", fields: [d("signedOn", "Day of"), t("printName", "Print Name"), t("phone", "Phone Number"), t("notaryPublic", "Notary Public")] },
    ],
  },
  {
    id: "af7-mold", group: "Mold", pdf: "mold-affidavit-of-compliance-af-7.pdf",
    title: "Affidavit of Compliance (AF-7)", subtitle: "Mold violations issued on or after January 19, 2019 — fewer than 10 units (any class), Class A for 10 or more units, or upgraded Class B",
    titleKeys: ["violationNumbers", "address"],
    sections: [
      { title: "Violation", fields: [t("violationNumbers", "Violation Number(s)", true), t("apartment", "Apt #")] },
      { title: "Affidavit", fields: [t("signerName", "I, (type or print name)", true), t("address", "1. Full building address, including borough", true), { key: "capacity", label: "2. I am the", type: "select", options: ["", "Currently registered owner of the property", "Currently registered managing agent of the property", "Otherwise registered as responsible for the property", "Currently registered officer or director of the corporation that owns the property", "Owner or shareholder of record of a tenant-occupied condominium or cooperative unit"] },
        { key: "workDoneBy", label: "4. The corrective work was performed by", type: "select", options: ["", "Myself, my employee, or my managing agent", "Licensed mold assessment and mold remediation firms (licenses attached)"] }],
        note: "3. I have read HPD's guide to Local Law 55 of 2018 mold work practices and understand the safe work practices required. 4. The work undertaken to correct the above-referenced violation(s) was performed in accordance with those work practices." },
      { title: "Signature", fields: [t("printName", "Print Name")] },
      { title: "Notary", fields: [t("county", "County of (State of New York)"), d("signedOn", "Sworn to before me this (date)"), t("notaryName", "Notary Print Name")] },
    ],
  },
  {
    id: "af8-mold", group: "Mold", pdf: "mold-affidavit-of-compliance-af-8.pdf",
    title: "Affidavit of Compliance (AF-8)", subtitle: "Mold violations issued on or after January 19, 2019 — 10 or more units, original Class B and Class C",
    titleKeys: ["violationNumbers", "address"],
    sections: [
      { title: "Violation", fields: [t("violationNumbers", "Violation Number(s)", true), t("apartment", "Apt #")] },
      { title: "Affidavit", fields: [t("signerName", "I, (type or print name)", true), t("address", "1. Full building address, including borough", true), { key: "capacity", label: "2. I am the", type: "select", options: ["", "Currently registered owner of the property", "Currently registered managing agent of the property", "Otherwise registered as responsible for the property", "Currently registered officer or director of the corporation that owns the property", "Owner or shareholder of record of a tenant-occupied condominium or cooperative unit"] }],
        note: "3. I have read HPD's guide to Local Law 55 of 2018 mold work practices and understand the safe work practices required. 4. The work undertaken to correct the above-referenced violation(s) was performed in accordance with those work practices. 5. Pursuant to Administrative Code §27-2017.9 and 28 RCNY §54-04, I have attached the following:" },
      { title: "5. Attached", checks: [cb("attRemediatorAffidavit", "Affidavit from the licensed mold remediation contractor — work followed the safe work practices and NYS Labor Law Article 32"), cb("attPlanAffidavit", "Affidavit from the licensed mold contractor — the remediation plan complied with Article 32"), cb("attAssessorAffidavit", "Affidavit from the licensed mold assessor — the post-remediation assessment report complied with Article 32"), cb("attAssessorLicense", "Copy of the mold assessor's license"), cb("attRemediatorLicense", "Copy of the mold remediator's or remediation supervisor's license"), cb("attDepRemediator", "DEP filing receipt — mold remediator"), cb("attDepAssessor", "DEP filing receipt — mold assessor")] },
      { title: "Signature", fields: [t("printName", "Print Name")] },
      { title: "Notary", fields: [t("county", "County of (State of New York)"), d("signedOn", "Sworn to before me this (date)"), t("notaryName", "Notary Print Name")] },
    ],
  },
  {
    id: "civ194-mold", group: "Mold", pdf: "hpd-mold-certificate-of-correction.pdf",
    title: "Certification of Correction of Violation(s) — Mold (CIV 194)", subtitle: "10 or more units (Class B and C)",
    titleKeys: ["violationNumbers", "novId"],
    sections: [
      { title: "Certification", fields: [t("county", "County of (State of New York)"), t("signerName", "I, (print name)", true),
        { key: "capacity", label: "1. Registered with the Division of Code Enforcement in the capacity of", type: "select", options: ["", "Owner of the property", "Officer or Director of the Corporation that owns the property", "Managing Agent of the property", "Otherwise registered as responsible for the property"] }] },
      { title: "2. Violation", fields: [t("novId", "Notice of Violation ID"), t("violationNumbers", "Violation number(s)", true), d("correctedOn", "Corrected on (date)")],
        note: "Corrected, including the source of the mold condition, in accordance with the safe work practices outlined in Administrative Code §27-2017.9 and 28 RCNY §54-04(b), by firms licensed to perform mold assessment and mold remediation or abatement in accordance with New York State Labor Law Article 32." },
      { title: "Attached", fields: [t("assessorFirm", "Mold Assessment Contractor license — Firm Name", true), t("remediatorFirm", "Mold Remediation Contractor (or Supervisor) license — Firm Name", true)],
        checks: [cb("attAssessorLicense", "A copy of the Mold Assessment Contractor license"), cb("attRemediatorLicense", "A copy of the Mold Remediation Contractor (or Supervisor) license"), cb("attAssessmentAffidavit", "Affidavit of Mold Assessment"), cb("attRemediationAffidavit", "Affidavit of Mold Remediation"), cb("attDepRemediator", "Department of Environmental Protection's (DEP) Mold Remediator's filing receipt"), cb("attDepAssessor", "DEP's Mold Assessor's filing receipt")] },
      { title: "Sworn to me this", fields: [d("signedOn", "Day of"), t("printName", "Print Name"), t("phone", "Phone Number"), t("notaryPublic", "Notary Public")],
        note: "3. My signature indicates that I am submitting a separate and distinct certification for each violation listed above by Violation Number." },
    ],
  },
  {
    id: "mold-assessment", group: "Mold", pdf: "hpd-affidavit-mold-assessment.pdf",
    title: "Affidavit of Mold Assessment", subtitle: "Sworn Statement from the Mold Assessor",
    titleKeys: ["violationNumbers", "address"],
    sections: [
      { title: "Assessor", fields: [d("dated", "Dated"), t("assessorFirm", "Licensed Mold Assessor's Firm Name", true), t("assessorLicense", "Mold Assessor's Firm License #"), d("assessorLicenseExpires", "Expiration Date"), t("firmAddress", "Firm's Address", true), t("firmPhone", "Tel"), t("firmEmail", "Email")] },
      { title: "Property", fields: [t("address", "Property Address", true), t("apartment", "Apt"), t("violationNumbers", "Violation Number(s)", true)] },
      { title: "Statement", fields: [t("assessorName", "I, (the licensed mold assessor)", true), d("planPreparedOn", "Prepared the mold remediation plan on"), d("postAssessmentOn", "Completed the post-remediation assessment on")],
        note: "…and determined that the licensed mold remediator corrected the mold hazard violation(s) using methods consistent with the mold remediation plan; the safe work practices outlined in Administrative Code §27-2017.9 and 28 RCNY §54-04; and the minimum work standards pursuant to Title 2 of Article 32 in the New York State Labor Law. I have provided the owner with a copy of the Post-Remediation Assessment Form. A copy of my mold assessment license in effect when the work was completed is attached, along with a filing receipt from the Department of Environmental Protection indicating submission of the Post-Remediation Assessment pursuant to Administrative Code §24-154.1." },
      { title: "Sworn to me this", fields: [d("signedOn", "Day of"), t("printName", "Print Name"), t("phone", "Phone Number"), t("notaryPublic", "Notary Public")] },
    ],
  },
  {
    id: "mold-remediation", group: "Mold", pdf: "hpd-affidavit-mold-remediation.pdf",
    title: "Affidavit of Mold Remediation", subtitle: "Sworn Statement from the Mold Remediator",
    titleKeys: ["violationNumbers", "address"],
    sections: [
      { title: "Remediator", fields: [d("dated", "Dated"), t("remediatorFirm", "Licensed Mold Remediation Firm Name", true), t("remediatorLicense", "Mold Remediator's Firm License #"), d("remediatorLicenseExpires", "Expiration Date"), t("supervisorLicense", "Mold Remediation Supervisor License # (if applicable)"), d("supervisorLicenseExpires", "Expiration Date"), t("firmAddress", "Firm's Address", true), t("firmPhone", "Tel"), t("firmEmail", "Email")] },
      { title: "Property", fields: [t("address", "Property Address", true), t("apartment", "Apt"), t("violationNumbers", "Violation Number(s)", true)] },
      { title: "Statement", fields: [t("remediatorName", "I, (the licensed mold remediator)", true), d("workStartedOn", "During the period commencing"), d("workCompletedOn", "and completed")],
        note: "…hereby swear that I performed the work to correct the above listed mold hazard violation(s) in accordance with the safe work practices outlined in Administrative Code §27-2017.9 and 28 RCNY §54-04; and the minimum work standards pursuant to Title 2 of Article 32 in the New York State Labor Law. I have provided the owner with a copy of the remediation work plan. A copy of my mold remediation license and mold supervisor license (if applicable) in effect when the work was completed is attached, along with a filing receipt from the Department of Environmental Protection indicating submission of the mold remediation work plan pursuant to Administrative Code §24-154.1." },
      { title: "Sworn to me this", fields: [d("signedOn", "Day of"), t("printName", "Print Name"), t("phone", "Phone Number"), t("notaryPublic", "Notary Public")] },
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

/** What HPD has on file for a violation (from the server's prefill lookup). */
export type HpdPrefill = { violationId: string; novId: string; registrationId: string; class: string; apartment: string; story: string; address: string; borough: string; zip: string; county: string; bbl: string; units: number; unitsSource: string; description: string; inspectionDate: string; novIssuedDate: string; signer: string; company: string; contacts: { type: string; name: string; organization: string; title: string }[] };

/** Which affidavit the violation calls for, and what has to go with it.
 *  Mice / rats / roaches → AF-6. Mold: fewer than 10 units, Class A, or an upgraded
 *  Class B → AF-7; 10 or more units, Class B or C → AF-8 with the assessor's and
 *  remediator's affidavits (and the CIV 194 certification) attached. */
export function affidavitPlan(v: HpdPrefill): { primary: FormDef; attachments: FormDef[]; why: string } | null {
  const d = v.description.toLowerCase();
  const f = (id: string) => formById(id)!;
  if (/mold|mould/.test(d)) {
    const cls = v.class.toUpperCase();
    if (v.units > 0 && v.units < 10) return { primary: f("af7-mold"), attachments: [], why: `${v.units} units (fewer than 10) → AF-7` };
    if (cls === "A") return { primary: f("af7-mold"), attachments: [], why: `Class A → AF-7` };
    if (v.units >= 10) return { primary: f("af8-mold"), attachments: [f("mold-assessment"), f("mold-remediation"), f("civ194-mold")], why: `${v.units} units, Class ${cls || "B/C"} → AF-8 with the assessor's and remediator's affidavits and DEP receipts` };
    return { primary: f("af7-mold"), attachments: [f("af8-mold"), f("mold-assessment"), f("mold-remediation"), f("civ194-mold")], why: "Unit count unknown — AF-7 opened; use AF-8 and the attachments if the building has 10 or more units" };
  }
  if (/mice|mouse|rat|roach|vermin|rodent|infest/.test(d)) return { primary: f("af6-vermin"), attachments: [], why: "Mice / cockroaches / rats → AF-6" };
  if (/lead[- ]based|lead paint|\blead\b|27-2056|order (616|617|624)/.test(d)) return { primary: f("lead-remediation"), attachments: [f("lead-disclosure")], why: "Lead violation → Lead Remediation Tracking with Disclosure" };
  return { primary: f("violation-timeline"), attachments: [], why: "General violation → Violation Correction Timeline" };
}

/** Fill a form from the violation on file. `last` = the company's most recent entry of the same form (firm names, licenses, phone carry over). */
export function prefillFromHpd(formId: string, v: HpdPrefill, last?: Record<string, unknown>): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const carry = (keys: string[]) => Object.fromEntries(keys.filter((k) => last && last[k] != null && String(last[k]).trim()).map((k) => [k, last![k]]));
  const fullAddress = [v.address, v.borough, "NY", v.zip].filter(Boolean).join(", ");
  const common = { violationNumbers: v.violationId, apartment: v.apartment, address: fullAddress, county: v.county, signedOn: today };
  switch (formId) {
    case "af6-vermin":
      return { ...common, registrationNumber: v.registrationId, signerName: v.signer, printName: v.signer, ...carry(["phone"]) };
    case "af7-mold":
    case "af8-mold":
      return { ...common, signerName: v.signer, printName: v.signer, ...carry(["capacity", "workDoneBy"]) };
    case "civ194-mold":
      return { ...common, novId: v.novId, signerName: v.signer, printName: v.signer, ...carry(["phone", "assessorFirm", "remediatorFirm", "capacity"]) };
    case "mold-assessment":
      return { ...common, dated: today, ...carry(["assessorFirm", "assessorLicense", "assessorLicenseExpires", "firmAddress", "firmPhone", "firmEmail", "assessorName", "printName", "phone"]) };
    case "mold-remediation":
      return { ...common, dated: today, ...carry(["remediatorFirm", "remediatorLicense", "remediatorLicenseExpires", "supervisorLicense", "supervisorLicenseExpires", "firmAddress", "firmPhone", "firmEmail", "remediatorName", "printName", "phone"]) };
    case "lead-remediation":
      return { ...common, hpdViolation: v.violationId, unit: v.apartment, ...carry(["rrpContractor", "rrpCertification", "rrpPhone"]) };
    case "lead-disclosure":
      return { ...common, unit: v.apartment, owner: v.signer, ...carry(["owner"]) };
    case "violation-timeline":
      return { property: fullAddress, unit: v.apartment, violationNumber: v.violationId };
    default:
      return common;
  }
}

/** What an HPD violation is about, for the affidavit buttons: lead, vermin and
 *  mold get an affidavit; everything else goes the dismissal-request route. */
export type ViolationKind = "lead" | "vermin" | "mold" | "other";
export function violationKind(description: string): ViolationKind {
  const d = description.toLowerCase();
  if (/lead[- ]based|lead paint|\blead\b|27-2056|order (616|617|624)/.test(d)) return "lead";
  if (/mold|mould/.test(d)) return "mold";
  if (/mice|mouse|\brats?\b|roach|vermin|rodent|\bpest|infest/.test(d)) return "vermin";
  return "other";
}
export const KIND_LABEL: Record<ViolationKind, string> = { lead: "Lead", vermin: "Vermin", mold: "Mold", other: "Dismissal" };
