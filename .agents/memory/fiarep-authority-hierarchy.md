---
name: FIAREP authority hierarchy
description: The confirmed authority ordering and rule for expanding Administrator permissions.
---

Borough Director is FIAREP's highest authority and has full override across modules, workflows, procurement, staff, and developments. An account may have the Administrator role while deriving top authority from the Borough Director position.

Ordinary Administrators are limited to assigned developments and lower-authority staff. Do not infer or add further Administrator capabilities; define them incrementally as the user specifies them.

Emergency Unit is an explicit issued-code staff identity, not a Worker mode. Emergency records and actions must remain assignment-scoped across normal reads, synchronization, and workflow actions.

**Why:** The user explicitly confirmed that Borough Director ranks above Administrator and wants to define Administrator capabilities over time.

**How to apply:** Make authorization position-aware. Check Borough Director first, then apply only explicitly established Administrator permissions and existing lower-role rules. Never rely on a locally entered unit code as server authorization.