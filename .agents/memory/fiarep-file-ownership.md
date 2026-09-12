---
name: FIAREP file ownership
description: Durable authorization rules for private stored files and historical file compatibility.
---

Private stored files must be bound to an immutable tenant, entity, and record owner. Editable entity JSON may describe a file, but it must not redefine ownership after the immutable binding exists.

**Why:** Treating a copied object path in client-editable state as proof of ownership allows someone who learns a path to attach it to a record they control and cross a development boundary.

**How to apply:** Authorize uploads against an existing record, authorize downloads through the immutable owner and current record visibility, and keep Resident photo grants on their report-scoped path. Historical files may be claimed only from one safe, same-tenant, non-deleted reference; zero or multiple references must deny.