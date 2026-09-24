---
name: FIAREP mobile spreadsheet security
description: Why the styled scope spreadsheet export no longer uses the old SheetJS npm packages.
---

Do not reintroduce the npm `xlsx` package or its `xlsx-js-style` fork for on-device scope exports. Preserve styled XLSX output with a library that Expo can bundle for iOS and Android.

**Why:** The old SheetJS npm release has high-severity advisories with no patched npm version, and the styling fork is based on that obsolete code. Replacing it was necessary to remove the vulnerable dependency without dropping the scope export.

**How to apply:** When changing spreadsheet generation, verify the lockfile audit, bundle both mobile platforms, and round-trip a styled workbook using the library's browser entry. Avoid assuming Node-only spreadsheet libraries work in Expo.