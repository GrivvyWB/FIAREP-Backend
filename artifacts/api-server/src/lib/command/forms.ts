// The Command Center fills a Company Form: "fill the AEU2 for summons 035551995X",
// "fill a lead disclosure for 430 Belmont Ave, apartment 3B". The form is saved on
// the Company Forms page, filled from the City's records, for the person to check and sign.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { buildingByAddress, findForm, FORM_TITLES, formValuesFor, oathSummons } from "../formPrefill";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function commandFillForm(tenantId: string, p: { form: string; address?: string; summons?: string; apartment?: string }, by: { id: string; name: string }) {
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  if (obj(obj(org?.features)["modules"])["company-forms"] !== true) return { error: "Company Forms isn't switched on for this organization." };
  const f = findForm(p.form || (p.summons ? "certificate-of-correction" : "")); if ("error" in f) return f;
  let values: Record<string, unknown>; let where: string;
  if (p.summons) {
    const r = await oathSummons(tenantId, p.summons); if ("error" in r) return r;
    values = formValuesFor(f.id, r.building, r.summons); where = r.building.full;
  } else if (p.address) {
    const b = await buildingByAddress(tenantId, p.address); if ("error" in b) return b;
    values = formValuesFor(f.id, b); where = b.name ? `${b.name} — ${b.full}` : b.full;
  } else return { error: "Which building? Give the address (or the summons number for an AEU2)." };
  const apt = (p.apartment || "").trim();
  if (apt) { values["apartment"] = apt; values["unit"] = apt; }
  const label = [values["summonsNumber"], where, apt ? `Apt ${apt}` : ""].filter(Boolean).join(" · ");
  const now = new Date(); const id = randomUUID();
  await db.insert(entityRecords).values({
    id, tenantId, entity: "compliance-forms", development: null,
    state: { formId: f.id, values, label, createdByName: `${by.name} (Command Center)`, createdById: by.id, updatedByName: `${by.name} (Command Center)`, updatedById: by.id },
    createdBy: by.id, createdAt: now, updatedAt: now,
  });
  // url: the phone shows it as an Open button (the form opens on the website, signed in).
  return { form: FORM_TITLES[f.id], name: FORM_TITLES[f.id], saved: label, filled: Object.keys(values), url: `https://fiarep.com/company-forms?entry=${id}`, note: "Saved on Company Forms. Open it there, check it and sign." };
}
