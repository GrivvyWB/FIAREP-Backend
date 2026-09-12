---
name: FIAREP installation personas
description: Permanent separation between Resident, Vendor, and Staff entry experiences on mobile and web.
---

A new mobile installation presents exactly three choices: Resident, Vendor, and Staff. The selected persona is installation-scoped and cannot be changed from inside the app. Resident and Vendor open without staff authentication; Vendor uses only the Procurement-issued job ID inside its workspace.

**Why:** Resident and Vendor users must never see staff access, Vendor users must never see Resident access, and Staff users need the complete staff role picker. Changing personas requires uninstalling and reinstalling the app.

**How to apply:** Store the write-once persona in app-local SQLite rather than SecureStore. Resident routes directly to Resident services, Vendor routes directly to Vendor access without a staff session, and Staff routes only to non-Resident/non-Vendor staff roles. Logout must preserve the persona.

The website follows the same write-once separation in browser-local storage. Public Resident and Vendor routes never render the staff shell. Staff routes require a verified server session, and stale staff tokens on a public persona are cleared.