---
name: FIAREP scoring authority
description: Rules for keeping operational scores consistent across mobile and management web.
---

Development, vendor, building, and residential scores must be calculated by one authenticated, tenant-scoped server contract. Development scores require an active property in the tenant property catalog; free-text development labels on records do not establish a scoreable development. Inspections contribute to both Development and Building scores. Vendor scores require closed, rated jobs; unrated closures do not produce a score. Assigned developments receive a neutral baseline only when backed by an active property. Mobile and web display the server response rather than maintaining separate formulas.

**Why:** Separate device calculations caused formula wording to disagree with actual weights, displayed an undefined deduction count, and left building/residential scoring unavailable on management web. Omitting inspections hid real Development activity, while scoring unrated vendor closures produced misleading results. Legacy resident reports with a free-text development but no property incorrectly created Development Performance scores.

**How to apply:** Change formula inputs, weights, thresholds, and output fields in the shared scoring contract and pure server calculations first, regenerate clients, then update both surfaces. Mobile may use an explicitly identified local fallback only for score types with real local source data.