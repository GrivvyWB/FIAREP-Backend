---
name: FIAREP authority hierarchy
description: The confirmed authority ordering and rule for expanding Administrator permissions.
---

Borough Director is FIAREP's highest authority and has full override across modules, workflows, procurement, staff, and developments. An account may have the Administrator role while deriving top authority from the Borough Director position.

Ordinary Administrators are limited to assigned developments and lower-authority staff. Do not infer or add further Administrator capabilities; define them incrementally as the user specifies them.

“Administrator” is the single sign-in entrance for supervision, management, and managerial staff. Their stored role and position still determine the workspace and authority they receive after authentication; the shared entrance must not flatten permission levels.

**Why:** The user explicitly confirmed that these staff are all administrative positions at different levels, while Borough Director remains the highest authority.

**How to apply:** Make authorization position-aware. Check Borough Director first, then apply only explicitly established Administrator permissions and existing lower-role rules. Route management-role accounts through the Administrator login entrance while preserving their actual role.