---
name: OpenAPI codegen and Vite
description: Why active Vite apps need a clean restart after regenerating shared API client files.
---

After OpenAPI code generation, restart active Vite workflows before evaluating browser errors. The generator briefly removes and recreates shared client output files, which can make Vite report missing modules, invalid hook calls, or endpoint errors during hot reload even when generation and typechecks succeed.

**Why:** FIAREP's web workflow observed transient missing generated modules and invalid React hook errors while the generated client directory was being replaced. A clean workflow restart loaded the finished client and removed those errors.

**How to apply:** After changing the API specification and running code generation, finish the server change, restart the API and affected Vite workflow once, then assess only fresh logs produced after both services are ready.