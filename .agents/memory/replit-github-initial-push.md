---
name: Replit GitHub initial push
description: How to safely seed a new GitHub repository when Git CLI authentication disagrees with the connected Git provider.
---

For a new repository, create the remote through Replit’s Git settings and use the Git pane for the initial authenticated push if Git CLI operations continue to report an invalid credential.

**Why:** A GitHub App connection can appear active and healthy while shell Git authentication is still rejected. The Git pane may remain the only working credential path for the first push.

**How to apply:** Prepare a clean export branch that excludes internal files, temporarily expose it under the branch name the Git pane will push, use the pane once, verify the remote commit, and immediately restore the full workspace branch. Ignore uploaded-asset paths on the export branch before exposing it, because screenshot uploads can be auto-committed while that branch is active.