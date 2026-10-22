// Forms the City takes online. E-file opens the agency's own site (the person signs in
// with their own account) and lays out the answers in the order that site asks for them.
// Sources: DOB — nyc.gov/site/buildings/property-or-business-owner/certificate-of-correction.page
//          HPD — nyc.gov/site/hpd/services-and-information/ecertification.page
export type EfileTarget = { agency: string; site: string; url: string; guide: string; steps: string[]; keys: string[]; note?: string };

const HPD: Omit<EfileTarget, "keys"> = {
  agency: "HPD", site: "HPD eCertification", url: "https://webapps.hpdnyc.org/eSignature/Login.aspx",
  guide: "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/ecertification-processing.pdf",
  steps: ["Sign in with the HPD user account (the building's registration must be current and the person enrolled).", "Pick the building and enter the 24-hour phone number.", "Select the corrected violation(s), then enter the correction date and the vendor who did the work.", "Submit, check the pending certification, then sign in the DocuSign window.", "Save the confirmation and type its number below."],
  note: "Not for mold or vermin violations in Alternative Enforcement Program buildings, and not for lead violations. HPD's eCertification guide does not mention uploading affidavits — keep the signed affidavit on file.",
};

export const EFILE: Record<string, EfileTarget> = {
  "certificate-of-correction": {
    agency: "DOB", site: "DOB NOW: Safety", url: "https://a810-dobnow.nyc.gov/publish/Index.html#!",
    guide: "https://www.nyc.gov/assets/buildings/pdf/cofc_user_guide.pdf",
    steps: ["Sign in to DOB NOW: Safety with your NYC.ID.", "Open the summons and start a Certificate of Correction request.", "Type the answers below into the request (DOB no longer takes the AEU2 form itself).", "Upload the proof the guide lists — photos labeled with date, location and summons number, Before and After.", "Submit and type the confirmation number below."],
    keys: ["summonsNumber", "address", "boroughZip", "certifier", "certifierRole", "mailingAddress", "completedOn", "performedBy", "workerName", "workerCompany", "workerAddress", "licenseNumber"],
  },
  "civ194-mold": { ...HPD, keys: ["novId", "violationNumbers", "correctedOn", "signerName", "capacity", "assessorFirm", "remediatorFirm", "phone"] },
  "af6-vermin": { ...HPD, keys: ["violationNumbers", "apartment", "address", "registrationNumber", "signedOn", "signerName", "phone"] },
  "af7-mold": { ...HPD, keys: ["violationNumbers", "apartment", "address", "capacity", "workDoneBy", "signedOn", "signerName"] },
  "af8-mold": { ...HPD, keys: ["violationNumbers", "apartment", "address", "capacity", "signedOn", "signerName"] },
};
