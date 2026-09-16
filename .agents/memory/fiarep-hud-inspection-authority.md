---
name: FIAREP HUD inspection authority
description: Defines the device and role boundaries for HUD inspection submission and review.
---

CPMs and Inspectors create, complete, and resubmit HUD inspections from the mobile app. Supervisor Inspector and CPM Supervisor staff review the shared server record on the website and may Approve, Deny, or request Correction without editing inspection content.

**Why:** Field inspection capture belongs on mobile, while supervisory review belongs on the management website. Both surfaces must use one server-authoritative workflow so decisions and resubmissions remain synchronized.

**How to apply:** Keep inspection contents creator-owned and development-scoped. Treat status, review identity, review timestamp, and review decisions as server-managed workflow state.