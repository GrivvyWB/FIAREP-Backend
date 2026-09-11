---
name: FIAREP staff account authority
description: Authority and persistence rules for staff issuance, approval, and login across devices.
---

Approved staff accounts must be persisted to the shared backend before they are considered usable. Local SQLite may cache staff and hold pending imports, but it must not be the authority for login eligibility.

**Why:** Mobile issuance and approval previously updated only one device's SQLite database while login queried the shared server, so apparently approved users could not authenticate.

**How to apply:** Any staff create, approval, code reset, revocation, or migration flow must update the server-authoritative account first or reconcile with it. Cross-device login is the acceptance check.