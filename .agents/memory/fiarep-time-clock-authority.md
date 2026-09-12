---
name: FIAREP time-clock authority
description: Durable authority and safety rules for external attendance integrations and optional FIAREP mobile punching.
---

An organization's external clock remains authoritative when integrated. FIAREP imports immutable punch events for display and attendance calculations without changing normal staff authentication or allowing employees to edit imported punches.

**Why:** Attendance affects payroll and leave balances. Client-selected identities, timestamps, mutable imports, duplicate retries, or a punch racing with an administrator disabling access can create incorrect paid time.

**How to apply:** Keep provider imports internal and idempotent, validate organization and staff identity, and serialize them with mobile punches. Mobile clock-in/out is off by default and requires a Platform Owner organization switch; the server rechecks that switch within the punch transaction, derives the actor and timestamp, and records append-only events. Leave and time-off requests remain separate and available.