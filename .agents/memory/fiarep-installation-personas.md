---
name: FIAREP installation personas
description: Permanent first-launch separation between Resident, Vendor, and Staff mobile experiences.
---

A new mobile installation presents exactly three choices: Resident, Vendor, and Staff. The selected persona is installation-scoped and cannot be changed from inside the app.

**Why:** Resident and Vendor users must never see staff access, Vendor users must never see Resident access, and Staff users need the complete staff role picker. Changing personas requires uninstalling and reinstalling the app.

**How to apply:** Store the write-once persona in app-local SQLite rather than SecureStore. Resident routes only to Resident services, Vendor only to Vendor access, and Staff only to non-Resident/non-Vendor staff roles. Logout must preserve the persona.