---
name: FIAREP resident photo AI
description: Defines the optional tenant-controlled AI analysis boundary for residential complaint photos.
---

Residential complaint photos remain part of the normal complaint workflow whether AI is enabled or disabled. Residents always receive a complaint ID. Each complaint accepts only one resident photo; after selection or confirmation, photo controls must be disabled and duplicate confirmation must fail on the server. A saved AI analysis is immutable per complaint photo: reviewers may view the image and saved result but cannot analyze it again. AI analysis is a tenant-level option and its violation code and findings are available only to authorized supervisors and Management.

**Why:** Clients may decline AI analysis without losing photo evidence or changing the resident experience. Re-analysis could overwrite the original result after the photo became an official complaint, so the lock must be server-enforced across users and browsers. Internal classifications must not become part of the public complaint-status response.

**How to apply:** Default the tenant switch to off, enforce it on the server, preserve normal one-photo upload and complaint IDs in both states, gray out photo controls after selection, serialize confirmation per complaint, reject repeat analysis when that photo already has a saved scan, hide repeat-analysis controls from reviewers, and keep AI findings within authenticated tenant/development boundaries.