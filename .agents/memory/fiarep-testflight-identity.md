---
name: FIAREP TestFlight identity
description: Durable App Store Connect identity and release constraints for signed FIAREP iOS builds.
---

Signed FIAREP iOS binaries must use bundle identifier `com.fiarep.app` and target the existing FIAREP App Store Connect application with Apple ID `6811256624`. Use the same Apple Developer team that owns that application. The next reserved TestFlight build number after installed build 2 is build 3.

**Why:** The user explicitly confirmed the existing App Store Connect destination and asked that it be locked in for the next TestFlight build. A mismatched bundle identifier, developer team, or reused build number would prevent the binary from reaching the intended TestFlight application.

**How to apply:** Before the next signed iOS build, verify the effective Expo configuration still reports this bundle identifier and a build number greater than the latest uploaded build. Submit the binary to the existing App Store Connect application, not a newly created listing. Keep the production API domain injection separate from App Store identity, and do not create or upload a build until the user requests it.