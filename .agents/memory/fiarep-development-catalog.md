---
name: FIAREP organization development catalog
description: Authority rules for the development names available to each organization and its staff.
---

Platform Control owns each organization's approved development-name list. Organize this control data as Organization → Organization Type → Portfolio → Developments. NYCHA organizations may load the shared NYCHA catalog; other organizations use the names supplied during onboarding. Staff assignment must use this organization list rather than discovering or inventing names from staff records.

A configured development name and a registered property are separate records. Platform Control should show the registered property addresses grouped beneath their matching development so an empty property set is visible rather than implied.

Built-in organization catalogs are exclusive to the organization they name. Loading one replaces that organization’s known catalog instead of merging it, and unrelated organizations must not see catalog controls for NYCHA or L+M.

**Why:** Discovering developments from existing assignments creates a circular dependency: a new employee cannot be assigned until a development already appears on another record. A portfolio label alone does not establish property ownership or provide addresses. Cross-organization catalog controls allowed NYCHA and L+M names to be combined into an invalid portfolio.

**How to apply:** Save organization type and development names with the organization, show the resulting portfolio size in Platform Control, and group registered addresses by exact normalized development name. Match built-in catalogs by normalized organization identity, expose only the matching catalog control, and replace rather than merge authoritative lists. Expose only approved names to tenant staff, and require non-Borough-Director staff accounts to receive at least one approved development assignment.