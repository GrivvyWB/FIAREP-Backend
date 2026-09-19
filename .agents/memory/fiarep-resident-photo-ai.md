---
name: FIAREP resident photo AI
description: Defines the optional tenant-controlled AI analysis boundary for residential complaint photos.
---

Residential complaint photos remain part of the normal complaint workflow whether AI is enabled or disabled. Residents always receive a complaint ID. A complaint may contain multiple different resident photos. Each uploaded photo has its own identity and single-use upload confirmation. A saved AI analysis is immutable per photo: the same photo cannot be analyzed again, while another photo on the complaint can receive its own analysis. Reviewers may view images and saved results but cannot overwrite them. AI analysis is a tenant-level option and its violation code and findings are available only to authorized supervisors and Management.

**Why:** Residents may need to document several different areas under one complaint. Re-analysis could overwrite a photo's original result after it became official, so the lock must be server-enforced per photo across users and browsers without blocking analysis of other photos. Internal classifications must not become part of the public complaint-status response.

**How to apply:** Default the tenant switch to off, enforce it on the server, preserve multi-photo uploads and complaint IDs in both states, consume every upload grant only once, reject repeat analysis when that photo ID already has a saved scan, allow other photo IDs to be analyzed independently, hide repeat-analysis controls from reviewers, and keep AI findings within authenticated tenant/development boundaries.