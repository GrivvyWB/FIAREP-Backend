---
name: FIAREP organization licensing
description: Authority and enforcement rules for licensing FIAREP to separate customer organizations.
---

FIAREP Platform Owner authority is separate from all tenant staff roles, including Borough Director. Only the Platform Owner controls organization activation, suspension, expiration, limits, and onboarding.

Licensed property/address ownership is also Platform Owner-controlled. Platform Owner refresh credentials belong only in revocable server sessions and Secure, HttpOnly cookies; browser JavaScript may retain only the short-lived access token.

Organization onboarding creates the initial Borough Director account, not a Procurement account. The organization ID is used only for that initial authorized account access. The Borough Director then provisions all other leadership and staff, who sign in with their issued names and access codes without re-entering the organization ID. Procurement employees are provisioned from Team and follow the separate Procurement verification flow.

Platform Owner organization deletion is an explicit tenant purge: remove the organization even when it still has staff, properties, sessions, or operational records. Preserve the separate Platform Owner audit history and record the deletion there.

The protected default organization cannot be deleted, renamed, suspended, or relicensed, but Platform Owner may update its feature configuration, including adding or removing configured developments. Removing a configured development is not a silent cascade deletion of its staff or operational history.

**Why:** Customers receive licensed platform access without receiving source code or the ability to control their own license. A tenant administrator must never gain licensing authority or redefine which addresses route public complaints into its tenant. Procurement isolation must begin during onboarding rather than granting the first tenant account Procurement access. The Platform Owner expects Delete to remove the tenant directly rather than requiring manual cleanup of every dependent record.

**How to apply:** Enforce organization licenses during login, refresh, and every authenticated request. A configured expiration timestamp ends access and reports an effective expired status even when the organization is marked unrestricted; unrestricted does not override license dates. Missing customer licenses fail closed; the FIAREP default organization remains active and unrestricted. Allow feature/catalog updates to the default organization while rejecting protected organization-setting changes and organization deletion. Keep operational data tenant-scoped, use the licensed property registry for limits/routing, and audit every owner control-plane mutation. Preserve the Borough Director → Team provisioning → ordinary credential-only staff sign-in sequence. Treat the organization ID as initial organization access, not a standing credential required from every employee. Organization deletion must atomically remove all tenant-scoped database records before removing staff and the organization itself; never apply this purge behavior to the protected default organization.