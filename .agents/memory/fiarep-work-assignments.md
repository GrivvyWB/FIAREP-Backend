---
name: FIAREP work assignments
description: Durable rules for canonical operational assignments and supervisor authority.
---

Operational work is assigned by canonical staff identity. Names and other editable labels never establish permission to read, start, progress, or complete work. Only the canonically assigned staff member may perform field-work actions; Management, Administrators, and Borough Directors retain oversight but cannot start or complete another person's assignment. Only authorized supervisors may assign or repair an assignment.

An assigned complaint or violation remains locked to that member. It can be reassigned only after the current assignee releases it with a substantive update; linked manpower and source records must release together.

An assigned complaint is itself sufficient authority for the assigned worker to start and complete it. A trade-specific secondary record, such as an elevator job, must not become an additional dispatch requirement.

Elevator Service mechanics do not release assigned jobs from their mobile workflow; they start, repair, and complete them.

**Why:** Display names can change or collide, and accepting assignment fields from ordinary staff lets them grant themselves authority during create, update, or action requests. Requiring a second dispatch after canonical assignment blocks legitimate work and contradicts the assignment authority already established by the supervisor.

**How to apply:** Carry staff IDs through every client flow, validate targets against tenant, approval, role, and development scope, and reject assignment smuggling on every mutation path. Require assignment through dedicated actions and release through an assignee-only action that records the update before clearing assignment, except do not expose release controls to Elevator Service mechanics. Once assigned, route start and completion through the source record without requiring a parallel trade record. Enforce assignment filtering in the server’s list, detail, file, mutation, deletion, and action boundaries—not only in the UI. Staff dashboard totals, recent activity, watchlists, alerts, and every linked list must derive only from those server-filtered assigned records; never show tenant-wide counts or unassigned activity. Legacy name-only work fails closed until a supervisor reassigns it canonically; Procurement receives no operational override.