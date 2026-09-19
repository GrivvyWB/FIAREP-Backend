---
name: FIAREP emergency maintenance unit
description: Authority, hierarchy, and truck designations for Emergency Maintenance staff.
---

Superintendent Ⓔ manages every employee whose role is Emergency and whose position is Maintenance Worker. Ordinary Maintenance Workers assigned to a development remain outside this emergency unit.

Emergency truck drivers receive sequential TRK labels such as TRK-1 and TRK-2. Their generated sign-in code combines the truck number with a random suffix, such as TRK1-956G, while their login name remains their normal employee name. Truck drivers may enter only the four-character suffix on legacy mobile builds, but the signed-in unit must display the complete issued code. Onboarding creates a linked emergency-unit record owned by the canonical staff ID. Emergency Maintenance employees who do not drive emergency trucks receive neither a TRK label nor a truck-specific code. All members appear beneath Superintendent Ⓔ in the Team hierarchy.

Emergency Maintenance Workers receive the same maintenance functions as ordinary Maintenance Workers, plus their Emergency Unit access.

**Why:** Emergency truck drivers and other mobile emergency maintenance staff share one supervisory chain, while stationary development maintenance staff remain under their development supervision. A staff label alone does not create a truck; visibility and dispatch require a canonical unit record linked to that staff identity. Legacy installed builds restrict staff-code entry to four characters.

**How to apply:** Use the Emergency role plus Maintenance Worker position as the authoritative membership rule. In authorization and navigation, inherit ordinary Maintenance Worker capabilities and add emergency-job access. When HR completes a truck-driver intake, atomically assign the next TRK number, generate a unique truck-prefixed code, and create the linked unit. Replacement-code issuance generates a new suffix and repairs missing links for legacy truck drivers. Accept a four-character suffix only for a matching generated Emergency truck code; reject ambiguous matches. A TRK designation is not a separate role.