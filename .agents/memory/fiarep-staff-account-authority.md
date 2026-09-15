---
name: FIAREP staff account authority
description: Authority and persistence rules for staff issuance, approval, and login across devices.
---

Approved staff accounts must be persisted to the shared backend before they are considered usable. Local SQLite may cache staff and hold pending imports, but it must not be the authority for login eligibility.

Human Resources may save a complete employee record as pending while waiting for documents. Pending employees cannot sign in; the HR reminder remains unread until HR approves the employee, and approval generates the one-time access code.

Staff access codes are four-character credentials, either numeric or uppercase alphanumeric (for example, 6734 or Y48R), generated only by the server and shown once to the authorized issuer. Organizations and staff must never choose their own codes, and idempotent retries must never reveal an existing code. Every staff-code input must accept letters and numbers and must open a text/alphanumeric keyboard, never a numeric-only keypad.

Staff directory display groups are separate from authorization roles. Moving an existing employee into an HR display group must preserve the employee’s role, permissions, approval status, development assignments, and current access code.

**Why:** Mobile issuance and approval previously updated only one device's SQLite database while login queried the shared server, so apparently approved users could not authenticate. The user also requires directory reorganization without reissuing credentials or granting HR authority.

**How to apply:** Any staff create, approval, code reset, revocation, or migration flow must update the server-authoritative account first or reconcile with it. Use a separate stable issuance request ID for deduplication, never a discoverable staff ID as a credential-recovery key. Keep pending HR onboarding records inactive, link their reminder to the employee record, and clear it only on approval. Cross-device login is the acceptance check.