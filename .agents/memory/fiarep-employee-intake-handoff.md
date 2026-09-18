---
name: FIAREP employee intake handoff
description: Defines the three-step HR-owned employee intake, Team-account handoff, and access-code delivery.
---

Employee intake starts in HR Workspace as an unlinked draft containing the employee information. The unfinished employee then appears in Team, where HR generates the employee number and sign-in code. FIAREP atomically creates the Team account, links it to the existing HR record, and advances the record to In progress.

For Maintenance Worker intake, Team must offer Regular maintenance or Truck driver before generation. Regular maintenance creates a Worker account; Truck driver creates an Emergency account with the next sequential `TRK-` label.

The sign-in code is visible inside FIAREP for 24 hours after issuance, then hidden. Only HR may replace it, and replacement codes are emailed to the employee. After a successful code email, every code-email path is locked for 24 hours; failed delivery must not start the lock.

**Why:** HR enters employee information once, but Team owns employee-number and sign-in-code generation. Users must never type or invent an employee number.

**How to apply:** Keep HR drafts unlinked and visible in Team until generation. Generate a tenant-scoped employee number and sign-in code in one transaction, apply maintenance assignment before issuance, link by immutable staff ID, and never expose manual employee-number entry.