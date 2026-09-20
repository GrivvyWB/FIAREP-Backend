---
name: FIAREP HR authority
description: Human Resources authority boundaries across the employee lifecycle.
---

HR administers hiring and recruiting, onboarding and orientation, payroll coordination and benefits, vacation and sick leave, attendance policies, employee relations and complaints, performance processes, disciplinary processes, harassment and discrimination investigations, training and professional development, labor-law compliance, terminations and exits, and employee records.

HR authority is not unlimited. Pay changes, discipline, termination, layoffs, and similar policy-sensitive actions must follow company policy, required company approval, and applicable employment law. HR may advise or administer a process without being the sole final business decision-maker.

HR entity records are visible only to Human Resources, Administrators, and the specific employee identified by the record's canonical employeeStaffId. Management and supervisors receive no HR-record visibility through approval scope.

HR lifecycle notifications also stay with Human Resources. Supervisors and general Management must not receive internal HR record status alerts.

For leave, visibility and notifications are limited to HR and the employee. Supervisors, upper management, and administrators do not receive, review, approve, or deny another employee's leave request. HR decisions require confirmation with HR's own access code.

HR has full delete access inside the HR section. HR may soft-delete HR lifecycle records and permanently delete staff accounts within its authorized employee scope without the organization-wide deletion switch. This does not grant HR permission to delete unrelated operational records, its own account, or accounts in another organization.

HR may manually change eligible staff members' assigned developments. The shared staff account and linked HR employee record must be updated together.

**Why:** HR needs enough authority to administer the complete employee lifecycle without bypassing management approval, company policy, or legal safeguards.

**How to apply:** Give HR and Administrators full HR-record visibility, and give an employee access only to records whose employeeStaffId equals that employee's actor ID. Keep permitted leave and approval actions on separate role-scoped surfaces. Let HR move eligible staff among developments configured by Platform Control, keep required supervisor assignments non-empty, synchronize linked employee records, and audit the change. Allow confirmed HR-section deletion within HR's employee and tenant scope while keeping unrelated operational deletion under its existing controls. Preserve deletion audits and enforce all restrictions on the server rather than only hiding controls in the interface.