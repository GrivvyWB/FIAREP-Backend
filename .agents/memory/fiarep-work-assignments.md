---
name: FIAREP work assignments
description: Durable rules for canonical operational assignments and supervisor authority.
---

Operational work is assigned by canonical staff identity. Names and other editable labels never establish permission to read, start, progress, or complete work. Ordinary workers and inspectors see only operational records assigned to their staff ID; management and administrators retain oversight. Only authorized supervisors may assign or repair an assignment.

**Why:** Display names can change or collide, and accepting assignment fields from ordinary staff lets them grant themselves authority during create, update, or action requests.

**How to apply:** Carry staff IDs through every client flow, validate targets against tenant, approval, role, and development scope, and reject assignment smuggling on every mutation path. Enforce assignment filtering in the server’s list, detail, file, mutation, deletion, and action boundaries—not only in the UI. Legacy name-only work fails closed until a supervisor reassigns it canonically; Procurement receives no operational override.