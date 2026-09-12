---
name: FIAREP scoring authority
description: Rules for keeping operational scores consistent across mobile and management web.
---

Development, vendor, building, and residential scores must be calculated by one authenticated, tenant-scoped server contract. Mobile and web display that response rather than maintaining separate formulas.

**Why:** Separate device calculations caused formula wording to disagree with actual weights, displayed an undefined deduction count, and left building/residential scoring unavailable on management web.

**How to apply:** Change formula inputs, weights, thresholds, and output fields in the shared scoring contract and pure server calculations first, regenerate clients, then update both surfaces. Mobile may use an explicitly identified local fallback only for score types with real local source data.