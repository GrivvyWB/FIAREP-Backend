---
name: FIAREP public access model
description: Authentication and capability-code boundaries for residents and vendors.
---

Residents and vendors are public users, not approved staff accounts. Residents enter directly, submit a licensed address and complaint, receive an `RC-#####` complaint number plus a private status token, and check status with all three values. Vendors enter their name and the server-issued code Procurement emailed to view a released scope and submit pricing.

Resident photos use private, report-bound one-time upload grants. Staff discover photos by report and request downloads by photo ID; object paths are never public capabilities.

**Why:** Requiring staff-issued login credentials for Resident or Vendor contradicts the operating workflow. Public codes alone are guessable, and tenant-wide object paths do not prove report ownership.

**How to apply:** Keep Resident and Vendor outside staff login/approval routing. Persist resident lookup credentials only in private device storage. CPM may prepare scope content, but only website Procurement may release it; bids are accepted only while bidding is open.