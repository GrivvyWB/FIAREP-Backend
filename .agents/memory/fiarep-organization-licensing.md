---
name: FIAREP organization licensing
description: Authority and enforcement rules for licensing FIAREP to separate customer organizations.
---

FIAREP Platform Owner authority is separate from all tenant staff roles, including Borough Director. Only the Platform Owner controls organization activation, suspension, expiration, limits, and onboarding.

**Why:** Customers receive licensed platform access without receiving source code or the ability to control their own license. A tenant administrator must never gain cross-organization licensing authority.

**How to apply:** Enforce organization licenses during login, refresh, and every authenticated request. Missing customer licenses fail closed; the FIAREP default organization remains active and unrestricted. Keep all operational data tenant-scoped.