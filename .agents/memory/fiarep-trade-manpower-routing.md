---
name: FIAREP trade manpower routing
description: Defines supervisor-to-supervisor requests for trade staffing on complaints and violations.
---

A supervisor or Management employee may send an assignment-ready complaint or violation to the supervisor responsible for the needed trade. Each source complaint or violation may be sent only once. The request remains pending until that receiving supervisor has eligible manpower, then the receiver assigns and dispatches the employee. Trade supervisors must not gain general complaint or violation visibility from broad development coverage; they see source records routed or assigned to them and Trade Requests addressed to them. Of ordinary supervisors, only the Supervisor Inspector may open violation and inspection-approval controls.

**Why:** The sending supervisor identifies the need, but the receiving trade supervisor knows whether their crew is available and must retain dispatch authority. Pending work must not be rejected only because manpower is temporarily unavailable. Organization-wide routing availability is not organization-wide operational visibility.

**How to apply:** Preserve the original work record and link it to a separate tenant-scoped request. Use canonical supervisor and employee IDs, enforce one request per source record in both the UI and server, match the employee to the requested trade and development, notify the receiver, filter trade-supervisor reads through the linked request or direct assignment, and update the source assignment only during an authorized dispatch. A trade supervisor’s employee picker contains only non-supervisor staff in that supervisor’s own trade and covered developments.