---
name: FIAREP organization licensing
description: Authority and enforcement rules for licensing FIAREP to separate customer organizations.
---

FIAREP Platform Owner authority is separate from all tenant staff roles, including Borough Director. Only the Platform Owner controls organization activation, suspension, expiration, limits, and onboarding.

Licensed property/address ownership is also Platform Owner-controlled. Platform Owner refresh credentials belong only in revocable server sessions and Secure, HttpOnly cookies; browser JavaScript may retain only the short-lived access token.

Organization onboarding creates the initial Borough Director account, not a Procurement account. The Borough Director signs in through the staff portal and provisions Procurement employees from Team; those employees then use the dedicated Procurement sign-in. This flow was user-confirmed on September 11, 2026.

**Why:** Customers receive licensed platform access without receiving source code or the ability to control their own license. A tenant administrator must never gain licensing authority or redefine which addresses route public complaints into its tenant. Procurement isolation must begin during onboarding rather than granting the first tenant account Procurement access.

**How to apply:** Enforce organization licenses during login, refresh, and every authenticated request. Missing customer licenses fail closed; the FIAREP default organization remains active and unrestricted. Keep operational data tenant-scoped, use the licensed property registry for limits/routing, and audit every owner control-plane mutation. Preserve the Borough Director → Team provisioning → Procurement sign-in sequence for new organizations.