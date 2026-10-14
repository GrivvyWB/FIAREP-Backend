// FIAREP's administrators, by name: Timothy Winn and Emily Winn on FIAREP's own
// organization ("default"). Pure — no database — so the permission rules in
// domain.ts can use it.
export const FIAREP_TENANT_ID = "default";
export const FIAREP_ADMIN_NAMES = ["timothy winn", "emily winn"] as const;

const normName = (name: unknown) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Is this person one of FIAREP's named administrators? */
export function isFiarepAdmin(person: { tenantId?: string | null; name?: string | null }): boolean {
  return (person.tenantId || "") === FIAREP_TENANT_ID &&
    (FIAREP_ADMIN_NAMES as readonly string[]).includes(normName(person.name));
}

/** A FIAREP administrator who still works in the field: they keep every tool
 *  their job title gives an Inspector / CPM on top of the administrator's. */
export function isFiarepFieldAdmin(actor: { role: string; tenantId?: string | null; name?: string | null }): boolean {
  return actor.role === "administrator" && isFiarepAdmin(actor);
}
