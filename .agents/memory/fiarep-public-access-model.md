---
name: FIAREP public access model
description: Authentication and capability-code boundaries for residents and vendors.
---

Residents and vendors are public users, not approved staff accounts. Residents enter directly, select or type their development, may choose an optional address from the official development catalog, submit a complaint, receive an `RC-#####` complaint number, and check status with that complaint number alone. The private status token is device-managed and must never be displayed in app or website UI. Vendors enter their name and the server-issued code Procurement emailed to view a released scope and submit pricing.

Resident photos use private, report-bound one-time upload grants. Staff discover photos by report and request downloads by photo ID; object paths are never public capabilities.

Vendor walk-through check-ins may reuse a released Procurement tracking code plus vendor name. A check-in requires an actual foreground GPS fix and a scheduled walk-through; GPS is evidence only and never grants access. Keep the check-in immutable, use server receipt time as authoritative, retain device time and accuracy as supporting evidence, and expose precise coordinates only to authorized Procurement staff.

**Why:** Requiring staff-issued login credentials for Resident or Vendor contradicts the operating workflow. The user explicitly chose typed development with no resident address requirement and complaint-number-only status lookup. Tenant-wide object paths still do not prove report ownership.

**How to apply:** Keep Resident and Vendor outside staff login/approval routing. Keep Development required and address optional. Offer official development and address suggestions publicly without staff authentication, while still accepting reviewed free text where the workflow permits it. Status lookup asks only for Complaint Number. Route reports to the matching licensed organization; when exactly one licensed customer organization exists, use it rather than the default organization. Persist resident tokens only in private device storage; never render, announce, copy, or request them in user-facing UI. CPM may prepare scope content, but only website Procurement may release it; bids are accepted only while bidding is open. Reject walk-through check-ins when GPS is unavailable, the scope is unreleased, no walk-through is scheduled, or an awarded scope names a different vendor.