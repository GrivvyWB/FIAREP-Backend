---
name: FIAREP field evidence sync
description: Durable rules for arrival, completion, GPS, and photo evidence across offline mobile work and server workflow authority.
---

Field arrival and completion must be recorded through the server's authorized workflow-action endpoint, while evidence metadata and uploaded file references continue through normal entity synchronization. If the action cannot run while offline, retain it with the queued entity mutation and replay it after the entity is available on the server.

**Why:** Workflow-managed status and timestamps are intentionally stripped from generic entity writes. Generic sync alone can preserve evidence fields but cannot legally advance an assigned job to started or completed.

**How to apply:** For every mobile field action, capture a fresh timestamp/GPS stamp at the action boundary, capture independent metadata for each photo, persist locally before network work, queue the entity immediately, and retry any failed workflow action in order during sync.