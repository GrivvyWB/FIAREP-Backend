---
name: FIAREP leave identity
description: Stable identity rules for employee leave visibility and workflow ownership.
---

An employee’s leave request belongs to the stable employee staff ID, even when Management submitted it on the employee’s behalf. The employee must be able to sync and view the request and its approved or denied status; the submitting manager’s creator identity does not replace employee ownership.

**Why:** Management may create a request for an employee. Filtering worker visibility by the record creator hides the request from the employee after approval.

**How to apply:** Resolve and persist the employee’s canonical staff ID when creating leave records. Authorize employee reads and status notifications by that ID, with legacy requester or creator identity used only when no employee ID exists. Refresh shared leave data before showing employee request status.