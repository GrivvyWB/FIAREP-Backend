---
name: FIAREP sync retries and login
description: Durable rules for mobile mutation retries and post-authentication synchronization.
---

Shared entity creation must be idempotent for a retry by the same authenticated actor, entity, and record ID. A lost response can leave a successful server insert in the mobile queue, so the next push must return the existing record instead of failing on the duplicate.

**Why:** Mobile connections can retry a mutation after the server has committed it. Treating that retry as a database error leaves the queue permanently pending and repeatedly replays an operation that already succeeded.

**How to apply:** Preserve record IDs across retries, return the actor's matching existing record, and reject collisions belonging to another actor, tenant, or entity.

Successful authentication must be persisted before optional local cache recovery, push registration, or synchronization. Failures in those follow-up steps must not turn a valid login into a user-visible authentication failure.

**Why:** Login and session restoration can otherwise report a backend error even after the server issued a valid session, locking the user on the login screen because an unrelated queued mutation or local cache operation failed.

**How to apply:** Keep credential validation and session persistence in the critical path; run cache maintenance and sync as recoverable post-authentication work.