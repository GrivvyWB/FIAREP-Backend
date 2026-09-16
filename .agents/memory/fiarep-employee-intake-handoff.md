---
name: FIAREP employee intake handoff
description: Defines the durable boundary between Team staff-account creation and HR employee-record completion.
---

Every new staff account begins in Team and must atomically create one tenant-scoped HR employee record linked to the new staff identity. HR completes that existing record rather than creating a second employee record.

**Why:** Team owns account issuance, role, position, and development access, while HR owns the employee file and lifecycle details. Keeping one linked handoff prevents staff accounts from existing without an HR completion path and avoids duplicate employee identities.

**How to apply:** Any new staff-creation path, including single and bulk intake, must use the same server-side transaction. Preserve the staff ID as immutable HR linkage, keep the HR workspace restricted to Human Resources, and edit the generated record in place.