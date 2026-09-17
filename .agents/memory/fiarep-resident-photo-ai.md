---
name: FIAREP resident photo AI
description: Defines the optional tenant-controlled AI analysis boundary for residential complaint photos.
---

Residential complaint photos remain part of the normal complaint workflow whether AI is enabled or disabled. Residents always receive a complaint ID. AI analysis is a tenant-level option and its violation code and findings are available only to authorized supervisors and Management.

**Why:** Clients may decline AI analysis without losing photo evidence or changing the resident experience. Internal classifications must not become part of the public complaint-status response.

**How to apply:** Default the tenant switch to off, enforce it on the server, preserve normal photo upload and complaint IDs in both states, and keep AI findings within authenticated tenant/development boundaries.