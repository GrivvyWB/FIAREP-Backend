---
name: GitHub repository authentication
description: How to distinguish connector status from working Git repository authentication in this workspace.
---

An integration card showing GitHub as active does not prove that Git commands can access private repositories. The generic GitHub connector may use Replit-provided credentials, and an accepted GitHub App connection may still expose no installation to the workspace.

**Why:** API calls returned authentication failures while GitHub appeared active, and the GitHub App connection did not provide a usable Git credential or repository installation.

**How to apply:** For source pushes, verify repository access with a read-only Git operation. If no credential is available, use Replit’s Version Control repository-link flow to select the existing repository instead of repeatedly reconnecting the generic connector.