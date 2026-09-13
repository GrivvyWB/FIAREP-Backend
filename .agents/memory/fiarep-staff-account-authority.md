---
name: FIAREP staff account authority
description: Authority and persistence rules for staff issuance, approval, and login across devices.
---

Approved staff accounts must be persisted to the shared backend before they are considered usable. Local SQLite may cache staff and hold pending imports, but it must not be the authority for login eligibility.

Staff access codes are four-character credentials, either numeric or uppercase alphanumeric (for example, 6734 or Y48R), generated only by the server and shown once to the authorized issuer. Organizations and staff must never choose their own codes, and idempotent retries must never reveal an existing code.

**Why:** Mobile issuance and approval previously updated only one device's SQLite database while login queried the shared server, so apparently approved users could not authenticate.

**How to apply:** Any staff create, approval, code reset, revocation, or migration flow must update the server-authoritative account first or reconcile with it. Use a separate stable issuance request ID for deduplication, never a discoverable staff ID as a credential-recovery key. Cross-device login is the acceptance check.