---
name: FIAREP EAS build compatibility
description: Compatibility constraints discovered while producing signed FIAREP builds with EAS.
---

Keep EAS builds on the workspace's tested pnpm major version rather than allowing EAS to select a newer default.

**Why:** A newer EAS-default pnpm release interpreted the workspace build-script policy differently and rejected an approved native build dependency during frozen installation.

**How to apply:** When changing the workspace package manager, validate its frozen install behavior before changing the version used by EAS.

Do not retain unused legacy Expo native modules in the mobile dependency set.

**Why:** An unused deprecated media module compiled against removed Expo module headers and failed the signed iOS Xcode build even though application code never imported it.

**How to apply:** Before signed builds, remove unused native dependencies and confirm any direct Expo core dependency is still required by local native modules.