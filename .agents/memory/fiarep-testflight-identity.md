---
name: FIAREP TestFlight identity
description: Durable App Store Connect identity and release constraints for signed FIAREP iOS builds.
---

Signed FIAREP iOS binaries must use bundle identifier `com.fiarep.app` and target the existing FIAREP App Store Connect application with Apple ID `6811256624`. Use the same Apple Developer team that owns that application. The next reserved TestFlight build number after installed build 2 is build 3.

The previous signed TestFlight delivery used the existing Expo EAS project rather than a new Replit Launch project. In Launch, choose **Use existing** for both the Expo project and Apple app so the prior identity and credentials can be reused; do not create replacement projects or app records.

**Why:** The user explicitly confirmed the existing Expo EAS and App Store Connect destinations and asked that they remain the release path. A mismatched project, bundle identifier, developer team, or reused build number would prevent the binary from reaching the intended TestFlight application.

**How to apply:** Before the next signed iOS build, select the existing Expo project and existing Apple app, then verify the effective Expo configuration still reports this bundle identifier and a build number greater than the latest uploaded build. Submit the binary to the existing App Store Connect application, not a newly created listing. Keep the production API domain injection separate from App Store identity, and do not create or upload a build until the user requests it.