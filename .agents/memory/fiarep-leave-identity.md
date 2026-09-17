---
name: FIAREP leave identity
description: Stable identity rules for employee leave visibility and workflow ownership.
---

An employee’s leave request belongs to the stable employee staff ID, even when Management submitted it on the employee’s behalf. The employee must be able to sync and view the request and its approved or denied status; the submitting manager’s creator identity does not replace employee ownership.

Management staff are employees and may submit their own leave requests, but cannot approve or deny their own requests. On the website, the dashboard Pending Leave view is for staff review, while the sidebar Leave view is for the signed-in manager’s own leave time.

Borough Directors do not receive employee leave-time visibility. They may retain access to their own leave request and status but not the team leave calendar or other employees’ records.

HR may initiate temporary leave for another employee and view the resulting team leave record without gaining approval authority. Temporary leave records capture start, end, and return date/time. Permanent departure deactivates access and preserves the employee record instead of deleting it.

Time off has two approval ranges: 1–14 calendar days is decided by the employee’s authorized management or supervisor; 30–365 calendar days is decided only by HR after HR code confirmation and requires a reasonable-accommodation entry. Requests for 15–29 days or more than 365 days are invalid.

**Why:** Management may create a request for an employee. Filtering worker visibility by the record creator hides the request from the employee after approval. The user explicitly excluded Borough Directors from employee leave-time visibility.

**How to apply:** Resolve and persist the employee’s canonical staff ID when creating leave records. Authorize employee reads and status notifications by that ID, with legacy requester or creator identity used only when no employee ID exists. Restrict Borough Director lists, sync, calendars, menus, and direct routes to the director’s own leave records. Refresh shared leave data before showing employee request status. Compare the approver with the employee ID before allowing a decision, keep personal leave entry separate from team review controls, validate that end and return timestamps follow the start timestamp, and enforce the duration-specific approver and accommodation rules on both create/update and approval.