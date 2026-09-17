---
name: FIAREP directory scope
description: Distinguishes staff-directory and routing visibility from leave-approval authority.
---

Staff-directory and operational routing lists must include employees whose development assignments overlap the viewer's assignments. A candidate covering many or all developments remains visible when at least one development is shared. For management and supervisor routing recipients, an empty development assignment represents client-wide coverage and must match every development. Leave-approval authority stays narrower and may require the employee's full assignment scope to be contained within the approver's scope.

**Why:** Reusing leave-approval authorization for the staff directory hid an all-development trade supervisor from a manager assigned to Jefferson, even though both covered Jefferson and the supervisor was otherwise eligible.

**How to apply:** For staff browsing and routing selectors, test shared development coverage and treat an empty recipient scope as client-wide only for management or supervisor routing. Keep policy decisions such as leave approval on their dedicated authorization rules instead of using directory visibility as approval authority.