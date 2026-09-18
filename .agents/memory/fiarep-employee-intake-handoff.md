---
name: FIAREP employee intake handoff
description: Defines the three-step HR-owned employee intake, Team-account handoff, and access-code delivery.
---

Employee intake starts in HR Workspace as an unlinked draft containing the employee information. After HR obtains and enters the employee number, FIAREP atomically creates the Team account, links it to the existing HR record, and advances the record to In progress. HR then emails the generated sign-in code.

The sign-in code is visible inside FIAREP for 24 hours after issuance, then hidden. Only HR may replace it, and replacement codes are emailed to the employee.

**Why:** HR must enter employee information only once, while the employee number remains a distinct prerequisite for creating the operational account. The delayed atomic handoff prevents incomplete staff accounts and duplicate employee identities.

**How to apply:** Keep employee drafts unlinked until the employee-number step. Create and link the Team identity in one tenant-scoped transaction, preserve the staff ID as immutable linkage, synchronize later shared-field edits, and enforce code visibility and replacement on the server.