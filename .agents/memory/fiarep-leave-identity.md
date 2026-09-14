---
name: FIAREP leave identity
description: Stable identity rules for employee leave visibility and workflow ownership.
---

An employee’s leave request belongs to the stable employee staff ID, even when Management submitted it on the employee’s behalf. The employee must be able to sync and view the request and its approved or denied status; the submitting manager’s creator identity does not replace employee ownership.

Management staff are employees and may submit their own leave requests, but cannot approve or deny their own requests. On the website, the dashboard Pending Leave view is for staff review, while the sidebar Leave view is for the signed-in manager’s own leave time.

**Why:** Management may create a request for an employee. Filtering worker visibility by the record creator hides the request from the employee after approval.

**How to apply:** Resolve and persist the employee’s canonical staff ID when creating leave records. Authorize employee reads and status notifications by that ID, with legacy requester or creator identity used only when no employee ID exists. Refresh shared leave data before showing employee request status. Compare the approver with the employee ID before allowing a decision, and keep personal leave entry separate from team review controls.