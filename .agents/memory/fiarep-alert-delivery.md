---
name: FIAREP alert delivery
description: Required delivery and presentation behavior for operational alerts.
---

Resident complaints go immediately to Management and Administrators, with Borough Director visibility guaranteed by the authority hierarchy. Emergency, priority, elevator-down, and new Resident-report notifications must remain in the Inbox and appear red immediately; opening the Inbox must never delete emergency notifications.

**Why:** The user requires audible, visible operational alerts and explicitly expects the Borough Director to receive everything. Inbox-only database inserts, discarded sync notifications, delayed age-based escalation, and emergency cleanup can silently hide urgent work.

**How to apply:** Every server-created operational notification must invoke push delivery. Every synced notification must be persisted locally and produce sound/badge feedback when newly received. Retry device-token registration after login and session restoration. Expo Go cannot provide production remote push delivery, so retain the local synced-alert fallback; use an installed native build for background remote push.