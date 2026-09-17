---
name: FIAREP TestFlight identity
description: Durable App Store Connect identity and release constraints for signed FIAREP iOS builds.
---

Signed FIAREP iOS binaries must use bundle identifier `com.fiarep.app` and target the existing FIAREP App Store Connect application with Apple ID `6811256624`. Use the same Apple Developer team that owns that application.

The previous signed TestFlight delivery used the existing Expo EAS project rather than a new Replit Launch project. In Launch, choose **Use existing** for both the Expo project and Apple app so the prior identity and credentials can be reused; do not create replacement projects or app records.

**Why:** The user explicitly confirmed the existing Expo EAS and App Store Connect destinations and asked that they remain the release path. A mismatched project, bundle identifier, developer team, or reused build number would prevent the binary from reaching the intended TestFlight application.

By default, stop after producing the signed IPA; the user downloads it and uploads it with Apple Transporter. Do not automatically submit to App Store Connect unless the user explicitly requests that workflow.

**Why:** The user explicitly chose manual Transporter delivery so they retain control of when the binary is uploaded.

**How to apply:** Before the next signed iOS build, select the existing Expo project and existing Apple app, then verify the effective Expo configuration still reports this bundle identifier and a build number greater than the latest uploaded build. Produce the signed IPA without automatic submission. Keep the production API domain injection separate from App Store identity, and do not create or upload a build until the user requests it.