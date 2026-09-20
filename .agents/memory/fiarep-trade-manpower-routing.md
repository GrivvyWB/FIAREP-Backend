---
name: FIAREP trade manpower routing
description: Defines the Inspector-to-CPM scope chain and mutually exclusive Procurement or in-house trade routing.
---

A supervisor or Management employee may send an assignment-ready complaint or violation to the supervisor responsible for the needed trade. Each source complaint or violation may be sent only once. The request remains pending until that receiving supervisor has eligible manpower, then the receiver assigns and dispatches the employee. Trade supervisors must not gain general complaint or violation visibility from broad development coverage; they see source records routed or assigned to them and Trade Requests addressed to them. Of ordinary supervisors, only the Supervisor Inspector may open violation and inspection-approval controls.

For inspector violations, preserve this exact chain: Supervisor Inspector assigns one exact Inspector; the Inspector creates one linked violation and returns it; Supervisor Inspector sends the approved violation to one CPM Supervisor; CPM Supervisor assigns one exact CPM; that CPM creates and submits the linked scope back to the same CPM Supervisor. CPM Supervisor then chooses exactly one path: Procurement or an in-house Trade Supervisor. For in-house work, the receiving Trade Supervisor assigns and dispatches an eligible non-supervisor subordinate, who starts and completes the work with real uploaded photo evidence.

**Why:** Each role owns a distinct decision. Stable handoffs prevent skipped review, duplicate scopes, simultaneous vendor/in-house execution, and assignments outside the responsible trade or development.

**How to apply:** Use canonical staff IDs and deterministic linked records. Enforce exact role, development, ownership, one-result-per-assignment, one-scope-per-violation, and mutually exclusive branch transitions on the server. Do not treat hidden UI as authorization. Offline clients may show pending sync but must not claim a critical handoff succeeded before server acceptance.