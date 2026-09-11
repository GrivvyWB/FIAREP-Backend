---
name: FIAREP organization licensing
description: Authority and enforcement rules for licensing FIAREP to separate customer organizations.
---

FIAREP Platform Owner authority is separate from all tenant staff roles, including Borough Director. Only the Platform Owner controls organization activation, suspension, expiration, limits, and onboarding.

Licensed property/address ownership is also Platform Owner-controlled. Platform Owner refresh credentials belong only in revocable server sessions and Secure, HttpOnly cookies; browser JavaScript may retain only the short-lived access token.

**Why:** Customers receive licensed platform access without receiving source code or the ability to control their own license. A tenant administrator must never gain licensing authority or redefine which addresses route public complaints into its tenant.

**How to apply:** Enforce organization licenses during login, refresh, and every authenticated request. Missing customer licenses fail closed; the FIAREP default organization remains active and unrestricted. Keep operational data tenant-scoped, use the licensed property registry for limits/routing, and audit every owner control-plane mutation.