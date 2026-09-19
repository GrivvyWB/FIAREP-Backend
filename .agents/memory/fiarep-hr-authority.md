---
name: FIAREP HR authority
description: Human Resources authority boundaries across the employee lifecycle.
---

HR administers hiring and recruiting, onboarding and orientation, payroll coordination and benefits, vacation and sick leave, attendance policies, employee relations and complaints, performance processes, disciplinary processes, harassment and discrimination investigations, training and professional development, labor-law compliance, terminations and exits, and employee records.

HR authority is not unlimited. Pay changes, discipline, termination, layoffs, and similar policy-sensitive actions must follow company policy, required company approval, and applicable employment law. HR may advise or administer a process without being the sole final business decision-maker.

HR entity records are visible only to Human Resources, Administrators, and the specific employee identified by the record's canonical employeeStaffId. Management and supervisors receive no HR-record visibility through approval scope.

HR lifecycle notifications also stay with Human Resources. Supervisors and general Management must not receive internal HR record status alerts.

For leave, visibility, notifications, and decisions are limited to HR, the employee, and the employee's immediate supervisor. Upper management and administrators do not receive or review staff leave requests merely because of their rank. HR decisions require confirmation with HR's own access code.

When an organization enables deletion in Platform Workspace, HR may permanently delete staff accounts within its authorized employee scope. This does not grant HR permission to delete unrelated operational records, its own account, or accounts in another organization.

**Why:** HR needs enough authority to administer the complete employee lifecycle without bypassing management approval, company policy, or legal safeguards.

**How to apply:** Give HR and Administrators full HR-record visibility, and give an employee access only to records whose employeeStaffId equals that employee's actor ID. Keep permitted leave and approval actions on separate role-scoped surfaces. Gate staff-account deletion on both the organization switch and HR's employee scope. Add explicit confirmation and approval boundaries to high-impact actions, preserve audit records, and enforce all restrictions on the server rather than only hiding controls in the interface.