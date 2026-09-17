---
name: FIAREP employee intake handoff
description: Defines the durable boundary between Team staff-account creation and HR employee-record completion.
---

Every new staff account begins in Team and must atomically create one tenant-scoped HR employee record linked to the new staff identity. HR completes that existing record rather than creating a second employee record. HR changes to the linked employee's name, position, and development assignment must update the shared staff account in the same transaction.

**Why:** Team owns account issuance and role authority, while HR owns the employee file and completes identity and job-placement details. Keeping one linked handoff prevents duplicate employee identities and ensures operational routing uses HR's completed position and location.

**How to apply:** Any new staff-creation path, including single and bulk intake, must use the same server-side transaction. Preserve the staff ID as immutable HR linkage, keep the HR workspace restricted to Human Resources, edit the generated record in place, and atomically synchronize shared staff fields.