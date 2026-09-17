---
name: FIAREP trade manpower routing
description: Defines supervisor-to-supervisor requests for trade staffing on complaints and violations.
---

A supervisor or Management employee may send an assignment-ready complaint or violation to the supervisor responsible for the needed trade. The request remains pending until that receiving supervisor has eligible manpower, then the receiver assigns and dispatches the employee.

**Why:** The sending supervisor identifies the need, but the receiving trade supervisor knows whether their crew is available and must retain dispatch authority. Pending work must not be rejected only because manpower is temporarily unavailable.

**How to apply:** Preserve the original work record and link it to a separate tenant-scoped request. Use canonical supervisor and employee IDs, match the employee to the requested trade and development, notify the receiver, and update the source assignment only during an authorized dispatch.