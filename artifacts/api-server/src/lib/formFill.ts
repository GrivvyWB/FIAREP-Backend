// Writes a saved entry onto the actual government form (the PDF in the
// company-forms folder), so what comes out is the real form, filled in.
// Positions are measured on each PDF (points from the top-left, 612×792).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type Spot = { x: number; top: number; size?: number; max?: number };
type Layout = {
  text: Record<string, Spot>;
  /** Checkbox marks: value key → where the X goes. */
  checks?: Record<string, Spot>;
  /** Select fields drawn as a check: key → option text → spot. */
  options?: Record<string, Record<string, Spot>>;
  /** Date fields split as "day" / "month, year": key → [daySpot, monthSpot]. */
  dayMonth?: Record<string, [Spot, Spot]>;
  /** Date fields split as "Month D" / "YY" (for "________, 20___" blanks). */
  monthDayYear?: Record<string, [Spot, Spot]>;
};

const LAYOUTS: Record<string, Layout> = {
  "hpd-af6-vermin-affidavit.pdf": {
    text: {
      violationNumbers: { x: 150, top: 147, max: 290 }, apartment: { x: 82, top: 159, max: 42 }, county: { x: 100, top: 210, max: 42 },
      signerName: { x: 80, top: 247, max: 185 }, address: { x: 74, top: 330, max: 430 }, registrationNumber: { x: 206, top: 378, max: 104 },
      printName: { x: 288, top: 680, max: 164 }, phone: { x: 288, top: 722, max: 164 },
    },
    dayMonth: { signedOn: [{ x: 56, top: 643 }, { x: 138, top: 643 }] },
  },
  "hpd-mold-certificate-of-correction.pdf": {
    text: {
      county: { x: 84, top: 123, max: 75 }, signerName: { x: 46, top: 146, max: 164 },
      novId: { x: 352, top: 279, max: 97 }, violationNumbers: { x: 96, top: 291, max: 200, size: 9 }, correctedOn: { x: 362, top: 314, max: 148 },
      assessorFirm: { x: 354, top: 349, max: 208, size: 8 }, remediatorFirm: { x: 425, top: 384, max: 136, size: 8 },
      printName: { x: 290, top: 605, max: 175 }, phone: { x: 290, top: 640, max: 175 },
    },
    options: { capacity: {
      "Owner of the property": { x: 75, top: 204 },
      "Officer or Director of the Corporation that owns the property": { x: 75, top: 217 },
      "Managing Agent of the property": { x: 75, top: 230 },
      "Otherwise registered as responsible for the property": { x: 75, top: 243 },
    } },
    checks: { attAssessorLicense: { x: 108, top: 350 }, attRemediatorLicense: { x: 108, top: 385 }, attAssessmentAffidavit: { x: 108, top: 409 }, attRemediationAffidavit: { x: 108, top: 421 }, attDepRemediator: { x: 108, top: 433 }, attDepAssessor: { x: 108, top: 445 } },
    dayMonth: { signedOn: [{ x: 40, top: 571 }, { x: 132, top: 571 }] },
  },
  "hpd-affidavit-mold-assessment.pdf": {
    text: {
      dated: { x: 110, top: 135, max: 140 }, assessorFirm: { x: 265, top: 173, max: 272 }, assessorLicense: { x: 235, top: 199, max: 114 }, assessorLicenseExpires: { x: 444, top: 199, max: 94 },
      firmAddress: { x: 153, top: 224, max: 385 }, firmPhone: { x: 95, top: 249, max: 142 }, firmEmail: { x: 319, top: 249, max: 219 },
      address: { x: 165, top: 287, max: 297 }, apartment: { x: 497, top: 287, max: 42 }, violationNumbers: { x: 177, top: 325, max: 361 },
      assessorName: { x: 84, top: 358, max: 200 }, printName: { x: 362, top: 641, max: 176 }, phone: { x: 362, top: 676, max: 176 },
    },
    monthDayYear: { planPreparedOn: [{ x: 402, top: 377 }, { x: 517, top: 377 }], postAssessmentOn: [{ x: 311, top: 396 }, { x: 426, top: 396 }] },
    dayMonth: { signedOn: [{ x: 76, top: 606 }, { x: 175, top: 606 }] },
  },
  "hpd-affidavit-mold-remediation.pdf": {
    text: {
      dated: { x: 107, top: 123, max: 140 }, remediatorFirm: { x: 270, top: 148, max: 265 }, remediatorLicense: { x: 244, top: 173, max: 102 }, remediatorLicenseExpires: { x: 441, top: 173, max: 94 },
      supervisorLicense: { x: 272, top: 199, max: 74 }, supervisorLicenseExpires: { x: 441, top: 199, max: 94 },
      firmAddress: { x: 151, top: 226, max: 384 }, firmPhone: { x: 93, top: 251, max: 141 }, firmEmail: { x: 316, top: 251, max: 219 },
      address: { x: 162, top: 289, max: 297 }, apartment: { x: 495, top: 289, max: 42 }, violationNumbers: { x: 174, top: 327, max: 361 },
      remediatorName: { x: 81, top: 366, max: 190 }, printName: { x: 359, top: 630, max: 176 }, phone: { x: 359, top: 664, max: 176 },
    },
    monthDayYear: { workStartedOn: [{ x: 327, top: 442 }, { x: 430, top: 442 }], workCompletedOn: [{ x: 72, top: 461 }, { x: 175, top: 461 }] },
    dayMonth: { signedOn: [{ x: 73, top: 596 }, { x: 172, top: 596 }] },
  },
};

export function canFill(file: string): boolean { return file in LAYOUTS; }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function parseDate(v: unknown): { day: number; month: string; year: number } | null {
  const s = String(v ?? "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { day: Number(m[3]), month: MONTHS[Number(m[2]) - 1] || "", year: Number(m[1]) };
}
function ordinal(n: number): string { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; }
/** "2026-10-11" → "October 11, 2026" for plain date blanks. */
function longDate(v: unknown): string { const d = parseDate(v); return d ? `${d.month} ${d.day}, ${d.year}` : String(v ?? ""); }

function draw(page: PDFPage, font: PDFFont, spot: Spot, text: string) {
  if (!text) return;
  let size = spot.size ?? 10;
  if (spot.max) while (size > 6 && font.widthOfTextAtSize(text, size) > spot.max) size -= 0.5;
  page.drawText(text, { x: spot.x, y: 792 - spot.top, size, font, color: rgb(0.05, 0.1, 0.4) });
}

export async function fillForm(file: string, blank: Uint8Array, values: Record<string, unknown>): Promise<Uint8Array> {
  const layout = LAYOUTS[file];
  if (!layout) throw new Error("This form cannot be filled automatically");
  const pdf = await PDFDocument.load(blank);
  const page = pdf.getPages()[0]!;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const isDateKey = (k: string) => /On$|^dated$|Expires$/.test(k);
  for (const [key, spot] of Object.entries(layout.text)) {
    const raw = values[key];
    draw(page, font, spot, isDateKey(key) ? longDate(raw) : String(raw ?? "").trim());
  }
  for (const [key, spot] of Object.entries(layout.checks ?? {})) if (values[key] === true || values[key] === "true") draw(page, bold, { ...spot, size: 11 }, "X");
  for (const [key, opts] of Object.entries(layout.options ?? {})) { const spot = opts[String(values[key] ?? "")]; if (spot) draw(page, bold, { ...spot, size: 11 }, "X"); }
  for (const [key, [daySpot, monthSpot]] of Object.entries(layout.dayMonth ?? {})) { const d = parseDate(values[key]); if (d) { draw(page, font, daySpot, ordinal(d.day)); draw(page, font, monthSpot, `${d.month}, ${d.year}`); } }
  for (const [key, [mdSpot, yySpot]] of Object.entries(layout.monthDayYear ?? {})) { const d = parseDate(values[key]); if (d) { draw(page, font, mdSpot, `${d.month} ${d.day}`); draw(page, font, yySpot, String(d.year).slice(2)); } }
  return pdf.save();
}
