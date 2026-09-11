---
name: Node test lifecycle fixtures
description: Reliable process-lifecycle fixtures under the workspace's Node test runner.
---

When a lifecycle fixture must stay alive until it is externally signaled, keep a real I/O handle open, such as a local server. An unresolved promise does not keep the event loop alive, and timer-only attempts were not reliable under this workspace's Node test runner.

**Why:** A timer-based hanging fixture exited before the launcher could signal it, making routine signal tests nondeterministic.

**How to apply:** Use a loopback server listening on an ephemeral port for controlled hanging test processes, then let the external signal terminate the process.