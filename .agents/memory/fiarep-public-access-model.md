---
name: FIAREP public access model
description: Authentication and capability-code boundaries for residents and vendors.
---

Residents and vendors are public users, not approved staff accounts. Residents enter directly, type any address or use phone location, submit a complaint, receive an `RC-#####` complaint number, and check saved reports by complaint number and address. The private status token is device-managed and must never be displayed in app or website UI. Vendors enter their name and the server-issued code Procurement emailed to view a released scope and submit pricing.

Resident photos use private, report-bound one-time upload grants. Staff discover photos by report and request downloads by photo ID; object paths are never public capabilities.

**Why:** Requiring staff-issued login credentials for Resident or Vendor contradicts the operating workflow. Residents may be in any borough, Long Island, or elsewhere, so reporting cannot depend on a pre-managed address registry or an NYC-only constraint. Public codes alone are guessable, and tenant-wide object paths do not prove report ownership.

**How to apply:** Keep Resident and Vendor outside staff login/approval routing. Let the phone reverse-geocode its current location when permission is available, but always allow manual address entry and editing. Route an exact existing tenant-property match to that tenant; otherwise route the report to default FIAREP operations instead of rejecting it. Persist resident lookup credentials only in private device storage and resolve the token internally from a saved report; never render, announce, copy, or request it in user-facing UI. CPM may prepare scope content, but only website Procurement may release it; bids are accepted only while bidding is open.