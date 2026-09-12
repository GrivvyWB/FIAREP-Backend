---
name: FIAREP cross-device parity
description: Rules for keeping operational data consistent between mobile and management web.
---

Mobile SQLite is an offline cache, never an independent authority. Operational mutations must reach the same server records and authorized workflow actions used by web; web must invalidate affected operational queries so mobile changes appear without a hard reload.

**Why:** A single aggregate cursor could skip notifications or newly authorized entities, local workflow decisions could remain device-only, filtered deletions could survive on one device, and stale web caches could hide valid mobile updates.

**How to apply:** Queue local mutations immediately, replay failed workflow actions, use metadata-only authorized tombstones, keep record and notification cursors separate, maintain per-entity cursors scoped by tenant/staff/role/developments, and invalidate related web list/detail/dashboard/activity/score queries after mutations.