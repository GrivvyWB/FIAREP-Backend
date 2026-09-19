---
name: FIAREP deletion controls
description: Product placement and authority rules for organization-level deletion controls.
---

The organization-wide `Delete enabled` switch belongs in Platform Control’s Module Management page alongside the tenant module switches, not in organization registration or editing.

**Why:** The user explicitly identified Module Management as the expected and correct place for this control.

Tenant administrators may delete every tenant-owned record, including staff accounts, HR lifecycle records, submitted inspections, procurement history, and other compliance records.

**Why:** The user explicitly chose unrestricted administrator deletion, including compliance history.

**How to apply:** Keep deletion disabled by default. Module Management must include the FIAREP default tenant in its organization selector and label it `FIAREP`; never hide it while listing customer tenants. Platform Control selects the organization and changes `Delete enabled`; this switch must save immediately without requiring the page’s separate module Save Changes action. Once enabled, administrators receive record-level Delete actions across every entity type. Preserve tenant isolation, audit each deletion, and prevent the signed-in administrator from deleting their own account. Do not cache the tenant deletion-policy response.