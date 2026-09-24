---
name: FIAREP Expo publish startup
description: Distinguishing a harmless React Native DevTools warning from actual Expo publish failures.
---

Do not assume the React Native DevTools missing-libglib message causes an Expo publish failure. Determine whether Metro became ready and whether the bundles and manifests finished before changing system dependencies.

**Why:** The same DevTools message appeared in both a successful publish and a failed one; the actual failed step was Metro readiness timing out under build conditions.

**How to apply:** Compare recent successful and failed publish logs. Treat the DevTools message as nonfatal when Metro progresses; focus on the first step that stops advancing, especially the readiness deadline or an exited process.