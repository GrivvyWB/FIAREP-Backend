---
name: FIAREP public access model
description: Authentication and capability-code boundaries for residents and vendors.
---

Residents and vendors are public users, not approved staff accounts. Residents enter directly, submit an address and complaint, receive an `RC-#####` complaint number, and check status with that number plus the address. Vendors enter their name and the code Procurement emailed to view a released scope and submit pricing.

**Why:** Requiring staff-issued login credentials for Resident or Vendor contradicts the operating workflow. Vendor scope visibility is granted by a Procurement-issued capability code, while resident status privacy relies on the complaint number plus matching address.

**How to apply:** Keep Resident and Vendor outside staff login/approval routing. CPM may prepare scope content, but only Procurement may release it to vendors. Do not expose draft or merely CPM-submitted scopes through public vendor lookup.