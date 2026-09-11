# FIAREP — What's Left To Build

Current as of this session. Everything below is NOT yet done.

---

## BIG FEATURES REMAINING (from the multi-dev spec)

### C. Trade workers → multi-development access
- [ ] Management can assign a trade worker (plumber, electrician, elevator mech, carpenter, plasterer) to ANY development
- [ ] A worker assigned to multiple developments can access all of them
- [ ] Worker's jobs/list reflect all their assigned developments

### D. Emergency Unit system
- [ ] Management assigns Emergency Units (Truck 1, Truck 2, Truck A, etc.) to any development
- [ ] Each emergency job gets a unique Emergency Job ID
- [ ] Emergency updates + photos flow back to the assigning supervisor
- [ ] Emergency flag/priority shows the job at top of lists

### F. "Red items" access restriction (admin/director/superintendent only)
Hide these from regular Supervisors — reserved for administrator/director/superintendent:
- [ ] HUD Inspections
- [ ] Procurement
- [ ] Change Orders (the cost-approval list)
- [ ] Vendor Score / Development Scores
- [ ] Review Reports / report admin
- [ ] Staff Approvals
- [ ] Audit Log
- [ ] Default / Project Rates
- [ ] (confirm the full list of which modules each supervisor tier may see)

---

## PHASE B — Emergency Work-Order button (earlier spec, still open)
- [ ] Emergency flag on a job (must complete today / next day)
- [ ] Emergency notes mandatory when flagged
- [ ] Emergency flag follows the job through CPM, workers, procurement
- [ ] Emergency jobs sort to top
(Note: overlaps with D above — may merge.)

---

## PHASE A leftovers — resident data threading further downstream
Resident complaint data (RC-#, name, unit, location) should stay pre-filled at EVERY hop:
- [ ] Inspector-logged BuildingViolation carries the resident data onto itself
- [ ] CPM scope displays complaint # / resident / unit / location / violation details
- [ ] Vendor quote carries the same complaint context (read-only)
- [ ] Worker My Jobs shows complaint # / resident / location on the job
- [ ] Procurement shows the full pre-filled package (scope, violation, resident, notes, orders)
- [ ] Photos carry through each hop (complaint photo visible downstream)
- [ ] Location-only complaints (Hallway, Lobby, Stairwell, Basement) fully supported end-to-end

---

## PHASE C — Procurement vendor payout stages
- [ ] Payout buttons: 15% / 20% / 30% / Final completion
- [ ] Procurement selects payout stage by job progress
- [ ] Payout history shown on the job

---

## TWO-STAGE DELETE — replicate the pattern to other record types
(Inspection chain already done; staff can't delete in My Jobs.)
- [ ] Scopes: management "Clear for staff" → then staff can dismiss
- [ ] Resident reports: same pattern
- [ ] Routes: same pattern

---

## ELEVATOR SYSTEM — polish / follow-ups
- [ ] Resident-report assignment to an Elevator Service mechanic should ALSO create the EL- job up front (currently the "Open Elevator Services" button creates it on the spot — works, but the job doesn't show in the supervisor dashboard until the mechanic opens it)
- [ ] Confirm elevator mechanic sees ONLY Elevator Services + Change Order everywhere (project screen done; verify no other entry points)

---

## HOUSEKEEPING / KNOWN ISSUES
- [ ] Wipe test data (duplicate scopes/jobs inflating dev scores, old mislabeled "resident" report)
- [ ] Regenerate BACKEND-WIRING-SPEC to include everything added since (vendor_quotes, project_scopes, elevator_jobs, change-order lifecycle + cost/photos, resident complaint fields, dev-scoring, inspection chain, walkthrough/bid-close, etc.)
- [ ] Reconcile branches (iOS main vs backend master); regenerate Drizzle journal
- [ ] Remove stray file lib/photos.ts.bak.1786739646
- [ ] Optional: normalize addresses in dev-scoring (same address typed differently = separate buckets)
- [ ] Unused import cleanup (e.g. deleteBuildingViolation in my-jobs, openDev in dev-scores) — harmless but tidy

---

## THE BACKEND (the big separate project — after the app features)
- [ ] Wire lib/store.ts functions to the API (the single seam)
- [ ] Cross-device sync (nothing syncs today — this is the #1 gap for a real pilot)
- [ ] APNs push notifications
- [ ] S3 for photos / scans / scope files
- [ ] Session invalidation on role/tier change
- [ ] City violation lookup via NYC Open Data (HPD/DOB by BBL/address)
- [ ] Enforce all role rules server-side (they're UI-only today)
- [ ] Test-data wipe on the backend tenant before connecting

---

## DONE THIS SESSION (for reference — do NOT redo)
- Inspection→approval→routing engine; two-track repairs (staff workers + vendors)
- CPM + worker change-order systems (cost, photos, decline→edit→resubmit, view original scope)
- Address lookups (CPM, procurement, worker)
- Role gating + price-hiding (workers/inspectors/elevator mechs see no pricing)
- Worker trade headings; "Staff" login label; supervisor routing to Management + title headers
- Development Scores per-development dropdown
- Elevator Service system (EL- IDs, mechanic form with photos, Elevator Supervisor dashboard)
- Delete-permission fix (staff can't delete assigned jobs)
- Nature of Work redesigned to single category dropdown + Remove button; Cellar/Basement category
- Complaint/Violation # pre-fill on Assign a Job; unit optional for building-level reports
- Removed Resident Reporting from management (prevents mislabeled reports)
- Audit Log category dropdown (empty until picked, Close button)
