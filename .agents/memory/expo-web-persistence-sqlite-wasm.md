---
name: Expo web persistence and SQLite WASM
description: Replit Expo web-preview requirements discovered while verifying FIAREP session restoration.
---

Native mobile tokens must remain SecureStore-first. Expo web preview needs a separate origin-scoped browser persistence path because SecureStore may report success without surviving reload, and the SQLite fallback may not be ready or durable when startup routing checks the session.

Metro must treat `wasm` as an asset for `expo-sqlite` web workers.

**Why:** The Expo web shell rendered blank when Metro could not resolve the SQLite WASM binary, and successful logins returned to the credential form after reload when token cleanup assumed SecureStore was durable on web.

**How to apply:** Verify both the correct Expo-domain root URL and one full reload. Keep native token cleanup conditional on successful native SecureStore writes; never weaken native storage to match web behavior.