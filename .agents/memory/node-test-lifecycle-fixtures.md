---
name: Node test lifecycle fixtures
description: Reliable process-lifecycle fixtures under the workspace's Node test runner.
---

When a lifecycle fixture must stay alive until it is externally signaled, keep a real I/O handle open, such as a local server. An unresolved promise does not keep the event loop alive, and timer-only attempts were not reliable under this workspace's Node test runner.

**Why:** A timer-based hanging fixture exited before the launcher could signal it, making routine signal tests nondeterministic.

**How to apply:** Use a loopback server listening on an ephemeral port for controlled hanging test processes, then let the external signal terminate the process.

For cancellation escalation tests, do not treat the Node test harness exiting as proof that its fixture exited. A signal-ignoring fixture can outlive the harness.

**Why:** The harness accepted a routine signal and exited while its fixture remained alive, so escalation triggered only by the harness staying alive missed the orphan.

**How to apply:** Put the launched test tree in its own process group. After the grace period, signal that group even if its leader has already exited, then verify the fixture PID is gone.