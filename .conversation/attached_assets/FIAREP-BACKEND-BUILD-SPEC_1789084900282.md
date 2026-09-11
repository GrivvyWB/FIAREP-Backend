# FIAREP Backend — Complete Build Specification

Hand this to the backend engineer/agent. It describes the entire server needed to
make the FIAREP iOS app (and website) multi-user and live. The app is currently
**local-first**: all data lives in on-device SQLite via `lib/store.ts` (215 exported
functions, 29 tables). The backend's job is to become the shared source of truth so
every device sees the same data, with push notifications, file storage, and
server-side role enforcement.

**Golden rule:** `lib/store.ts` is the single data seam. Every one of its exported
functions maps to exactly one backend endpoint. Build the API to mirror those
functions 1:1, then the app swaps its SQLite calls for HTTP calls with no UI changes.

---

## 1. STACK & ENVIRONMENT
- **Runtime:** Node.js 20+, Express 5.
- **ORM:** Drizzle.
- **DB:** PostgreSQL (AWS RDS). Existing box: `ubuntu@18.219.209.89`, repo `~/fiarep-api`, branch `master`.
- **Auth:** JWT (access + refresh). Staff log in with name + 4-char code (existing
  scheme). Residents/vendors are lighter-weight (see §5).
- **File storage:** AWS S3 (photos, scans, scope files, completion photos).
- **Push:** Expo Push API (app already integrates expo-notifications; it produces an
  Expo push token per device — store it and push to it).
- **Hosting:** the RDS + EC2 already exist; containerize with Docker, run behind nginx.

---

## 2. DATA MODEL — 29 TABLES
Each table in the app is stored as `(id TEXT PRIMARY KEY, state TEXT JSON)`. On the
backend, model each as a proper typed table (columns below) OR keep a JSONB `state`
column plus indexed columns for the fields you query on. Types come from the app's
TypeScript definitions — mirror them exactly.

### Core / identity
- **staff_accounts** — id, name, code (4-char), role (StaffRole: administrator |
  management | worker | inspector | procurement | vendor | resident), position
  (StaffPosition — see §6 list), developments (string[]), status (pending | approved
  | revoked), createdBy, createdAt, issuerName. UNIQUE(name, code) for login.
- **settings** — key/value (default rates, config).

### Projects & field work
- **projects** — id, name (address), createdAt, meta.
- **rooms** — id, projectId, name, line items, measurements, costs.
- **checklists** — id, projectId, renovation checklist state.
- **cost_estimates** — id, projectId, Nature-of-Work categories + amounts, totals.
- **project_scopes** — id, projectId, CSI Divisions/Sections line items (qty, unit, cost).
- **intakes** — id, projectId, building-intake data (+ optional geo stamp).
- **inspections** — id, projectId, building-inspection data.
- **elevators** — id, keyed by projectId OR elevator-job id; header{elevatorId,type,
  location,date}, items{recordId: {condition: Good|Repair|Replace|N/A, cost?, note?}},
  photos[].
- **roofplans** — id, projectId, roof sketch data.
- **project_notes** — id, projectId, note, by, at.
- **project_reviews** — id, projectId, decision (ProjectReviewDecision), by, at.

### Resident complaints & violations
- **resident_reports** — id, complaintNo (RC-#####), residentName?, contact?, location?,
  createdBy (resident|management), unit, address, description, photos[], status
  (submitted|assigned|in_progress|resolved), assignedTo?, development?, updates
  (ResidentUpdate[]), createdAt, rating?, resolvedAt?, clearedByMgmt?.
- **violations** — id, HPD violation-code catalog rows (code, class A/B/C, official text).
  NOTE: this is largely static reference data (383 codes); seed it, see §9.
- **building_violations** — id, building, violationNo, code, codeDesc, hazardClass
  (A|B|C), notes, photos[], loggedBy, loggedAt, status (logged|approved|routed|done),
  approvedBy/At, routedTo/ToPosition/At, completedBy/At, completionNote,
  completionPhotos[], clearedByMgmt, complaintNo?, residentName?, contact?.
- **priority_violations** — id, PriorityViolation records (Class C priority flags/acks).
- **route_assignments** — id, inspector route, RouteStop[] (address, status:
  reached|not_reached|pending), assignedTo, createdAt.

### Procurement & vendors
- **procurement** — id, trackingId (sr-#####), projectId, address, scope, scopeFile?,
  scopeFileName?, status (draft|approved|bidding|awarded|closed|returned), requestedBy,
  requestedAt, cpmNotes?, returnNote?, walkthroughAt?, walkthroughNote?, bidCloseAt?,
  awardedTo?, rating?.
- **procurement_bids** — id, procurementId, vendorName, amount, note, submittedAt.
- **vendor_contacts** — id, VendorContact (name, company, contact info).
- **vendor_quotes** — id, vendor quote records (locked + fallback modes).

### Change orders
- **change_orders** — id, reportId?, reportRef, targetName?, targetPosition?,
  description, cost, photos[], status (submitted|mgmt_approved|cost_approved|declined),
  createdByName, createdAt, isWorkerCO?, declineReason?.

### Elevator & emergency
- **elevator_jobs** — id, elId (EL-#####), address, unit, mechanic, refNum, issue,
  assignedBy, assignedAt, status (assigned|done), onMyWayAt?, startedAt?, completedAt?.
- **emergency_units** — id, name (truck label), code (TRK-####), createdAt.
- **emergency_jobs** — id, emId (EM-#####), truck, development, address, location,
  issue, photos[], assignedBy, assignedAt, status (assigned|done), onMyWayAt?,
  startedAt?, completedAt?, note?.

### Leave management
- **leave_requests** — id, employee, title, development, supervisor, type (LeaveType:
  Vacation|Sick|Childcare|Personal|LOA|Family Emergency|Jury Duty|Bereavement|Other),
  startDate, endDate, days, hours?, approvedDays?, reason?, status (Pending|Approved|
  Denied|Cancelled), requestedBy, requestedAt, decidedBy?, decidedAt?.
  Balances are DERIVED (annual allotment − approved days; 8h = 1 day) — compute
  server-side, don't store.

### System
- **notifications** — id, target (role name OR person name), message, detail?,
  reportId? (id of the related record; may be prefixed proj:/hud:), at, read.
- **audit_log** — id, actorRole, actorName, action, detail, reportId?, at.

---

## 3. ENDPOINTS — MIRROR THE 215 STORE FUNCTIONS
Build REST endpoints grouped by entity. Each app store function becomes one endpoint.
General shape: `GET /<entity>` (list), `GET /<entity>/:id`, `POST /<entity>` (create),
`PATCH /<entity>/:id` (update/decide), `DELETE /<entity>/:id`. Below are the
non-obvious ones that carry business logic — implement these server-side exactly.

### Staff / auth
- POST /auth/login {name, code, role} → verifyStaffLogin → JWT. bootstrapAdministrator.
- GET /staff (listStaffAccounts?status), POST /staff (issueStaffAccountFull),
  POST /staff/:id/reset-code (resetStaffCode), DELETE /staff/:id (deleteStaffAccount),
  POST /staff/:id/revoke. listStaffNames, listAssignableByTrade (grouped by position),
  developmentsForStaff, developmentsForManager, listManagementForDevelopment,
  leavePrefillForEmployee.

### Resident reports
- createResidentReport (generates RC- number), createManagementReport, listResidentReports,
  getResidentReport, assign, updateStatus, resolve+rate, deleteResidentReport,
  clearResidentReportForStaff (sets clearedByMgmt), lookupComplaintOrViolation.

### Inspections / violations
- addBuildingViolation (status=logged, auto-notify management, accepts photos[]),
  approveAndRouteViolation (→routed, notify recipient, Class C flag),
  completeRoutedViolation (→done, notify), listLoggedInspections, listActiveInspections,
  listRoutedInspectionsFor(name), getBuildingViolation, clearInspectionForStaff,
  deleteBuildingViolation. sendViolationLookup, getViolationLookup, listViolationLookups.
  Priority: outstandingPriorityFor, acknowledgePriorityViolation.
  Routes: createRouteAssignment, list, updateStop, etc.

### Scope / procurement / vendor
- submitProjectScope, repairScopeAddresses, createProcurementRequest (draft, sr- id),
  updateScopeDraft, listProcurementRequests(?status), broadcast (→bidding, walkthrough/
  bid-close fields), submitBid (notify procurement), listBids, awardBid, close+rate,
  returnScope, deleteProcurementRequest, findScopeForChangeOrder. Vendor: listVendorContacts,
  vendor quotes CRUD. contractorScores (VendorScore).

### Change orders
- createChangeOrder (CPM, cost+photos), createWorkerChangeOrder (no cost),
  approveChangeOrderMgmt, approveChangeOrderProcurement, approveWorkerChangeOrder,
  declineChangeOrder, resubmitChangeOrder, listChangeOrders, deleteChangeOrder.

### Elevator
- createElevatorJob (EL- id), listElevatorJobs, listElevatorJobsForMechanic, getElevatorJob,
  setElevatorProgress(onMyWay|started), completeElevatorJob, getElevator/setElevator.

### Emergency
- createEmergencyUnit (TRK- code), listEmergencyUnits, getEmergencyUnitByCode,
  deleteEmergencyUnit. createEmergencyJob (EM- id), listEmergencyJobs,
  listEmergencyJobsForTruck, getEmergencyJob, setEmergencyProgress, addEmergencyPhoto,
  completeEmergencyJob. getTruckScores.

### Leave
- createLeaveRequest, listLeaveRequests, listLeaveForEmployee, getLeaveRequest,
  decideLeaveRequest(status,approvedDays?), cancelLeaveRequest, deleteLeaveRequest,
  leaveBalances (DERIVED, server-computed).

### Scoring / dashboards
- getDevelopmentScores, deleteDevelopmentScore, deleteScoreItem, getTruckScores,
  contractorScores. listAllAddresses, listAddressesForDevelopment (recency-ordered).

### System
- notifications: addNotification, listNotifications(target), listAllNotifications,
  unreadCount(target), markNotificationRead, deleteNotification,
  clearEmergencyNotifications. audit: logAudit, listAuditLog, deleteAuditEntry,
  clearAuditLog. settings: get/set default rates. Actor: getCurrentActor,
  getCurrentPosition, setCurrentActor (session-derived server-side).

---

## 4. SYNC MODEL (the #1 gap — nothing syncs today)
The app is offline-capable. Implement:
- **Write-through:** app POSTs each mutation to the API; on success it updates local
  SQLite. On network failure it queues and retries (offline queue).
- **Pull sync:** on app foreground / pull-to-refresh, GET changed records since a
  `updatedAt` cursor per table. Add `updatedAt` to every row.
- **Conflict policy:** last-write-wins by `updatedAt` is acceptable for v1; flag
  concurrent edits to the same record for review.
- Keep the record IDs the app generates (uid = timestamp+random) as the primary key so
  offline-created records merge cleanly.

## 5. AUTH & ROLE ENFORCEMENT (server-side — currently UI-only)
Enforce EVERY role rule on the server; the app's gating is convenience only.
- StaffRole gates endpoints. Position (e.g. 'Regional Director', 'Borough Director',
  supervisor titles) gates finer actions.
- **Regional Director** can issue/delete everyone EXCEPT administrators.
- **Emergency admin** (administrator / Borough Director / Regional Director) only:
  create trucks, assign emergencies, truck scores.
- **F red-items**: restricted supervisors cannot hit HUD/Procurement/Change-Orders/
  Scores/Staff/Audit/Rates endpoints.
- **Delete lockdown**: workers cannot delete any assigned job; only after management
  sets clearedByMgmt. Only management/admin delete notifications.
- **Borough Director** leave view: server filters leave to management-tier titles.
- Workers/inspectors/elevator mechs: never return pricing fields to them.
- Session invalidation when a role/position changes or an account is revoked.

## 6. STAFF_POSITIONS (exact list, hierarchy order)
Borough Director, Regional Director, Property Manager, Assistant Property Manager,
Superintendent, Assistant Superintendent, Housing Assistant, Maintenance Worker,
Caretaker, Groundskeeper, Janitorial Staff, CPM, Inspector, Elevator Service, Plumber,
Electrician, Carpenter, Roofer, General Construction, CCTV Installation, Heating
Service, Staff Worker, Director, Other.

## 7. PUSH NOTIFICATIONS
- Store each device's Expo push token against the user (POST /devices/token).
- Whenever addNotification fires server-side, also send an Expo push to that target's
  devices (resolve target role/name → users → tokens).
- Emergency jobs: push to the assigned truck; leave decisions: push to the employee;
  inspection routing: push to the recipient. (These mirror the in-app notifications.)
- This is what enables background / app-closed / cross-device / PC alerts.

## 8. FILE STORAGE (S3)
- Photos/scans/scope files currently stored as local URIs. Backend: presigned-URL
  upload; store the S3 key on the record; return signed GET URLs.
- Applies to: resident_reports.photos, building_violations.photos/completionPhotos,
  elevator/emergency photos, change_orders.photos, project scans, scope files,
  FIAREP Vision photos.

## 9. INTEGRATIONS
- **OpenAI proxy (FIAREP Vision):** the app must NOT ship the OpenAI key. Add
  POST /ai/classify-violation {imageBase64} → server calls GPT-4o vision with the
  classification prompt (A/B/C + confidence + HPD code + trade + priority + description)
  → returns JSON. Move the key to server env; app calls this endpoint.
- **NYC Open Data (HPD/DOB):** endpoint to look up violations by address/BBL to enrich
  the violation catalog and pre-fill lookups.

## 10. SEED & MIGRATION
- Seed the HPD violation-code catalog (383 codes, 341 enriched) into `violations`.
- Seed DEVELOPMENT_NAMES list.
- Bootstrap the first administrator account.
- Provide a test-data wipe endpoint/script (dev only) — the local app currently has
  duplicate/test records to clear before go-live.
- LEAVE_ALLOTMENT defaults (days): Vacation 20, Sick 10, Childcare 12, Personal 5,
  Family Emergency 5, Bereavement 5; LOA/Jury Duty/Other = 0 (untracked). 8h = 1 day.

## 11. CODES GENERATED (keep formats identical to the app)
RC-##### resident complaint · sr-##### procurement tracking · EL-##### elevator job ·
EM-##### emergency job · TRK-#### truck code · staff login = 4 chars from
ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0/O/1/I). Violation numbers are entered manually.

## 12. DELIVERABLES CHECKLIST
- [ ] Postgres schema (Drizzle) for all 29 tables + updatedAt columns + indexes.
- [ ] JWT auth + staff login (name+code) + refresh + session invalidation.
- [ ] REST endpoints mirroring all 215 store functions (grouped per §3).
- [ ] Server-side role/position enforcement per §5.
- [ ] Sync endpoints (write-through + cursor pull) per §4.
- [ ] Device token registry + Expo push send on every notification per §7.
- [ ] S3 presigned upload/download for all photo/file fields per §8.
- [ ] OpenAI classify-violation proxy per §9.
- [ ] NYC Open Data violation lookup per §9.
- [ ] Seed scripts (violation catalog, developments, bootstrap admin) + test wipe per §10.
- [ ] Then: swap the app's lib/store.ts internals from SQLite to HTTP calls (same
      function signatures — no UI changes).

*Match every field name and code format to the app exactly, so the client swap is
mechanical. The app team keeps lib/store.ts function signatures stable; you provide
endpoints that return the same shapes.*
