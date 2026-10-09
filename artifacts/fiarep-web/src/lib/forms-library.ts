// Every official form, portal and guide a FIAREP job touches, from the
// building's first lookup to the last violation closed. Links are to the City's
// own pages and PDFs (nyc.gov) as checked on Oct 8, 2026.
export type FormEntry = { name: string; use: string; url: string; kind: "form" | "portal" | "guide"; fiarep?: string };
export type FormGroup = { title: string; intro: string; items: FormEntry[] };

export const FORM_GROUPS: FormGroup[] = [
  {
    title: "1. Before the job — look the building up",
    intro: "What is open, what is owed, who is registered. FIAREP pulls all of this on the Building lookup page; these are the City's own portals for the same records.",
    items: [
      { name: "HPDONLINE", use: "Open HPD violations, complaints and orders by address.", url: "https://hpdonline.nyc.gov/hpdonline/", kind: "portal", fiarep: "Building lookup → Violation log" },
      { name: "DOB NOW / BIS", use: "DOB violations, OATH summonses and Certificate of Correction requests.", url: "https://a810-dobnow.nyc.gov/publish/Index.html#!/", kind: "portal", fiarep: "Building lookup → DOB active violations" },
      { name: "DOF Property Information Portal", use: "Property tax account, charges and bills by BBL.", url: "https://propertyinformationportal.nyc.gov/", kind: "portal", fiarep: "Building lookup → Property tax (DOF) link" },
      { name: "HPD Property Registration Online System (PROS)", use: "Register or renew the building (annual deadline September 1; $13 fee billed by DOF). Registration must be current before HPD accepts any certification or dismissal request.", url: "https://a806-pros.nyc.gov/PROS/mdRInternet.html", kind: "portal", fiarep: "Building lookup → HPD registration box" },
      { name: "HPD — Register Your Property", use: "Rules, who must register, and the PROS link.", url: "https://www.nyc.gov/site/hpd/services-and-information/register-your-property.page", kind: "guide" },
    ],
  },
  {
    title: "2. HPD violations — correct and certify (free)",
    intro: "Certification deadlines from service: Class A 90 days · Class B 30 days · Class C 24 hours, except lead paint, window guards, mold, mice/roaches/rats 21 days, self-closing doors 14 days, heat and hot water none. Certification is free; a false certification is audited and penalised.",
    items: [
      { name: "HPD — Clear Violations (hub page)", use: "Every certification and dismissal route in one place, with the deadline table.", url: "https://www.nyc.gov/site/hpd/services-and-information/clear-violations.page", kind: "guide" },
      { name: "eCertification", use: "Certify corrections online. Not available for lead-based paint, mold or pest violations.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/ecertification-processing.pdf", kind: "portal" },
      { name: "Certification of Correction of Violations / Failures", use: "Paper certification when the NOV form is missing or not all violations are certified at once. Notarised; return to the Borough Service Center.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/certification-of-correction-of-violations.pdf", kind: "form" },
      { name: "Notice of Correction of Violation — Heat and Hot Water", use: "Heat / hot water violations only.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/certification-of-correction-of-violations-failures-heat.pdf", kind: "form" },
      { name: "Certificate of Correction — Mold (Class B / C)", use: "Mold violations in buildings of 10+ units; B/C mold issued after March 1, 2018 also needs the affidavit on the Indoor Allergen page.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/certificate-of-correction-mold.pdf", kind: "form" },
      { name: "Mold form — under 10 units (all classes) or 10+ units (Class A)", use: "Mold violations outside the B/C 10+ unit case.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/mold-form-2.pdf", kind: "form" },
      { name: "HPD — Indoor Allergen Hazards (mold and pests)", use: "Required documentation for mold and pest (roaches, mice, rats) violations, including the affidavit.", url: "https://www.nyc.gov/site/hpd/services-and-information/indoor-allergen-hazards-mold-and-pests.page", kind: "guide" },
      { name: "Certification of Correction — Reissuance", use: "Old violations reissued under the Violation Reissuance program when the original Reissuance NOV is not available.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/certification-of-correction-reissuance.PDF", kind: "form" },
      { name: "Certification of Correction of Failure (HQS)", use: "Housing Quality Standards failures with no related Housing Code violation.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/certification-of-correction-of-failure.pdf", kind: "form" },
      { name: "Clearing overdue violations (guide)", use: "What to do when the certification period has passed.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/overdue-violations.pdf", kind: "guide" },
      { name: "Clearing HPD Violations (guide)", use: "HPD's full guide: certification, dismissal requests, fees, borough offices.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/Clearing-HPD-Violations.pdf", kind: "guide" },
    ],
  },
  {
    title: "3. HPD lead-based paint violations",
    intro: "Certified on paper only, with the work method, cleanup and worker-training records attached, to the HPD Lead-Based Paint Inspection Program, 345 Adams Street, 10th Floor, Brooklyn, NY 11201 (Lead Hotline 212-863-5501).",
    items: [
      { name: "HPD — Lead-Based Paint page", use: "Certification instructions for Orders 616–625 and the exemption / contestation routes.", url: "https://www.nyc.gov/site/hpd/services-and-information/lead-based-paint.page", kind: "guide" },
      { name: "Orders 616 / 617 / 624 — certification and instructions", use: "Certify correction, request an extension, or address an inconclusive result.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/616-617-624-hqs-cert-and-instructions.pdf", kind: "form" },
      { name: "Order 616 — contestation", use: "Contest a lead-based paint violation.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/lead-based-paint-violation-contestattion.pdf", kind: "form" },
      { name: "Order 624 — contestation", use: "Contest an Order 624 lead violation.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/l-06-624-contestation.pdf", kind: "form" },
    ],
  },
  {
    title: "4. HPD violations — dismissal (inspection, fee)",
    intro: "When the certification period has passed, or the violation was written for the wrong place: HPD inspects and closes what is corrected or not found. Fee $250 (1–2 family) · $300 (1–300 open) · $400 (301–500) · $500 (501+) · $1,000 in AEP (to the AEP office, 212-863-8262). Since July 1, 2026 applications go to Code Enforcement — Central Violations Administration Unit, 345 Adams Street, 10th Floor, Brooklyn.",
    items: [
      { name: "Dismissal Request form (DR-1)", use: "The official form. FIAREP fills the entries and the cover letter for you.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/dismissal-request-form-clear-violations.pdf", kind: "form", fiarep: "Building lookup → Violation log → Prepare dismissal request" },
      { name: "Dismissal Request form with instructions (DR-1, 2013 layout)", use: "Same form with fee schedule and borough office addresses on the instruction pages.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/dismissal-request-form.pdf", kind: "form" },
      { name: "HPD Code Enforcement appointments", use: "Book a virtual or phone appointment about certifications, dismissal requests, mold/pest documentation or lead violations.", url: "https://hpdcode.timetap.com", kind: "portal" },
      { name: "Borough Service Centers", use: "Violation printouts and in-person help; phone numbers by borough.", url: "https://www.nyc.gov/site/hpd/contact/borough-service-centers.page", kind: "guide" },
    ],
  },
  {
    title: "5. DOB violations and OATH / ECB summonses",
    intro: "A DOB summons is heard at OATH; the penalty is cleared with a Certificate of Correction filed through DOB NOW (paper is no longer accepted at the Administrative Enforcement Unit). Questions: AEU (212) 393-2405 · OATH 1-844-628-4692.",
    items: [
      { name: "DOB — Steps to Correct an OATH Summons", use: "The step-by-step: DOB NOW → Certificate of Correction Review Request → upload AEU2 / AEU20 → Statements & Signature → Submit.", url: "https://www.nyc.gov/site/buildings/property-or-business-owner/steps-to-correct-an-oath-summons.page", kind: "guide", fiarep: "Building lookup → OATH / ECB summons" },
      { name: "AEU2 — Certificate of Correction", use: "The correction certificate for an OATH summons issued by DOB.", url: "https://www.nyc.gov/assets/buildings/pdf/aeu2.pdf", kind: "form" },
      { name: "AEU2 — instructions", use: "How to complete AEU2 and what to attach.", url: "https://www.nyc.gov/assets/buildings/pdf/aeu2ins.pdf", kind: "guide" },
      { name: "AEU20 — Statement in Support of Certificate of Correction", use: "Sworn statement filed with AEU2.", url: "https://www.nyc.gov/assets/buildings/pdf/aeu20.pdf", kind: "form" },
      { name: "AEU3321 — Certificate of Correction, Site Safety Training", use: "Only for summonses under BC 3321.1 / 3321.2 (AEU2 / AEU20 not accepted for those).", url: "https://www.nyc.gov/assets/buildings/pdf/aeu3321.pdf", kind: "form" },
      { name: "Certificate of Correction portal — user guide", use: "DOB NOW walkthrough with screenshots.", url: "https://www.nyc.gov/assets/buildings/pdf/cofc_user_guide.pdf", kind: "guide" },
      { name: "OATH — Certificate of Correction", use: "OATH's own certificate for summonses that allow a cure.", url: "https://www.nyc.gov/assets/oath/downloads/pdf/Certificate-of-Correction.pdf", kind: "form" },
      { name: "OATH — Cure", use: "OATH's cure submission.", url: "https://www.nyc.gov/assets/oath/downloads/pdf/Cure.pdf", kind: "form" },
      { name: "OATH — Hearing request form", use: "Request a hearing, including after a default.", url: "https://www.nyc.gov/assets/oath/downloads/pdf/hearing_requestform.pdf", kind: "form" },
      { name: "DOB — Forms & Applications", use: "Every DOB form in one list.", url: "https://www.nyc.gov/site/buildings/dob/forms.page", kind: "guide" },
    ],
  },
  {
    title: "6. HPD Alternative Enforcement Program (AEP)",
    intro: "Buildings in AEP: $500 per unit every six months after four months without discharge, capped at $1,000 per unit; $200 per complaint inspection; $100 per re-inspection. Dismissal requests go to the AEP office, not the borough.",
    items: [
      { name: "HPD — Alternative Enforcement Program", use: "Rules, fees, discharge criteria, yearly building lists.", url: "https://www.nyc.gov/site/hpd/services-and-information/alternative-enforcement-program-aep.page", kind: "guide", fiarep: "AEP registry" },
      { name: "AEP Rules (PDF)", use: "The full rule text.", url: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/AEP-Rules.pdf", kind: "guide" },
      { name: "HPD Charges and Fees", use: "Emergency repair charges, inspection fees, how they are billed.", url: "https://www.nyc.gov/site/hpd/services-and-information/hpd-charges-and-fees.page", kind: "guide", fiarep: "Building lookup → HPD emergency-repair charges" },
      { name: "HPD Penalties and Fees", use: "Civil penalties by class and the dismissal-request fee table.", url: "https://www.nyc.gov/site/hpd/services-and-information/penalties-and-fees.page", kind: "guide" },
    ],
  },
];
