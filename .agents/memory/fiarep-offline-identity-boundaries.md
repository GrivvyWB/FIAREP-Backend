---
name: FIAREP offline identity boundaries
description: Security and data-integrity rules for offline state shared by multiple staff on one device.
---

Treat every durable offline surface as server-identity scoped: mutation ownership, pull cursors, visible caches, conflict recovery, and persisted remote-file references. Rotate visible caches when tenant, staff, or development access changes, while retaining pending mutations under their original owner. Any cache reset must also reset its pull cursor so the emptied cache is fully hydrated again.

Legacy unowned mutations may be claimed only when durable pre-login identity evidence matches the currently authenticated server identity. Current login state is not valid evidence because it has already been overwritten.

**Why:** Shared devices can otherwise expose a prior property's records or upload offline edits under the wrong staff account. Keeping an advanced cursor after clearing local tables made existing server records appear deleted because later pulls requested only newer changes. Special-table metadata and process-memory photo registries also caused clean records and remote files to fail after restart.

**How to apply:** Any new offline entity or sync adapter must define its development scope, stable version metadata, owner-scoped queue behavior, cache-rotation and cursor-reset behavior, and persisted remote-file hydration before it is considered synchronized.