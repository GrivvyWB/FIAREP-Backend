---
name: FIAREP deletion controls
description: Product placement and authority rules for organization-level deletion controls.
---

The organization-wide `Delete enabled` switch belongs in Platform Control’s Module Management page alongside the tenant module switches, not in organization registration or editing.

**Why:** The user explicitly identified Module Management as the expected and correct place for this control.

**How to apply:** Keep deletion disabled by default. Platform Control selects the organization, changes `Delete enabled`, and saves the module settings. Authorized tenant staff then receive record-level Delete actions according to server-enforced role boundaries.