---
name: NYC property source resilience
description: How FIAREP should handle independent failures across official NYC property datasets.
---

Treat GeoSearch, HPD violations, DOB violations, and HPD complaints as independent upstream sources. Retry temporary 429/5xx responses briefly, then return every successful source with a source-specific warning for failures.

**Why:** NYC Socrata datasets can return temporary 503 responses independently while other datasets and address resolution remain healthy. Failing the entire lookup would hide useful official data.

**How to apply:** Keep official results read-only, cap each dataset, use stable BIN/BBL identifiers, and preserve partial success whenever a single upstream dataset is unavailable.