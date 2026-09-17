---
name: FIAREP installation personas
description: Permanent separation between Resident, Vendor, and Staff entry experiences on mobile and web.
---

A new mobile installation presents exactly three choices: Resident, Vendor, and Staff. The selected persona is installation-scoped and cannot be changed from inside the app. Resident and Vendor open without staff authentication; Vendor uses only the Procurement-issued job ID inside its workspace. Staff has one locked Staff Member sign-in using name and issued code; the verified server role and position determine the workspace automatically.

**Why:** Resident and Vendor users must never see staff access, Vendor users must never see Resident access, and staff should not choose or impersonate a role before authentication. Changing personas requires uninstalling and reinstalling the app.

**How to apply:** Store the write-once persona in app-local SQLite rather than SecureStore. Resident routes directly to Resident services, Vendor routes directly to Vendor access without a staff session, and Staff shows one role-neutral login that sends only name and code, then routes from verified server identity. Do not ask ordinary staff for an organization ID or show role-specific login tabs. Logout must preserve the persona.

The website follows the same write-once separation in browser-local storage. Public Resident and Vendor routes never render the staff shell. Staff routes require a verified server session, and stale staff tokens on a public persona are cleared.