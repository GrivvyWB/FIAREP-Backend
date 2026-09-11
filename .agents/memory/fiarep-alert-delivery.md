---
name: FIAREP alert delivery
description: Required delivery and presentation behavior for operational alerts.
---

Resident complaints go immediately to Management and Administrators, with Borough Director visibility guaranteed by the authority hierarchy. Emergency, priority, elevator-down, and new Resident-report notifications must remain in the Inbox and appear red immediately; opening the Inbox must never delete emergency notifications.

Only Borough Directors and Regional Directors may mute alert interruptions. Regular Management, Property Managers, Superintendents, and other supervisors must not see the mute control. Muting suppresses sound, vibration, and background push on that device, but red visual alerts and Inbox records remain available.

**Why:** The user requires audible, visible operational alerts and explicitly expects the Borough Director to receive everything. Inbox-only database inserts, discarded sync notifications, delayed age-based escalation, and emergency cleanup can silently hide urgent work.

**How to apply:** Every server-created operational notification must invoke push delivery. Every synced notification must be persisted locally and produce sound/badge feedback when newly received unless that upper manager has muted the device. Restrict mute UI and behavior to Borough Director and Regional Director positions; unregister muted devices from background push and re-register when unmuted. Retry device-token registration after login and session restoration. Expo Go cannot provide production remote push delivery, so retain the local synced-alert fallback; use an installed native build for background remote push.