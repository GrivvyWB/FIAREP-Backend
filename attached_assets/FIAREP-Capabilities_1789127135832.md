# FIAREP — Everything the Platform Does

Field Repair and Estimation Platform. A role-based iOS app that runs the full
lifecycle of building repair work — from a resident's complaint through
inspection, scoping, procurement, repair, and emergency response — with each role
seeing exactly the tools they need.

---

## THE ROLES

- **Resident** — reports issues in their unit or building.
- **Administrator** — full access; issues accounts; oversees everything.
- **Regional Director / Borough Director** — elevated management; can create staff
  and manage emergency trucks.
- **Management / Supervisors** — run day-to-day operations for their development(s).
  Supervisor titles (Plumber Supervisor, etc.) land in the management section with
  a restricted tool set; their exact title shows in the header.
- **CPM (Construction Project Manager)** — builds scopes of work and estimates.
- **Inspector** — logs building violations (A/B/C hazard class).
- **Procurement** — sends jobs to vendors, collects bids, awards, approves costs.
- **Trade Workers** — Plumber, Electrician, Maintenance, Carpenter, Roofer,
  Elevator mechanic, etc. Do the physical repairs.
- **Vendor / Contractor** — bids on and completes scoped work.
- **Emergency Unit (Truck)** — responds to emergencies across all developments.

---

## 1. RESIDENT COMPLAINTS

- Residents file a complaint (full, partial, or anonymous) with a location
  (apartment, building, hallway, compactor, elevator), description, and photos.
- Every complaint gets a friendly **complaint number (RC-#####)**.
- Complaints land in management's inbox; unit is optional for building-level issues.

## 2. INSPECTION & VIOLATIONS

- Management sends an inspector to look up a complaint/violation; the details
  pre-fill so nothing is re-typed.
- Inspectors log violations against a built-in **HPD violation-code catalog** (383
  codes with official order text and A/B/C hazard class).
- Logged inspections auto-notify management for approval.
- Inspectors can be assigned **routes** (address lists) and mark stops reached /
  not reached.
- On approval, management picks one of two paths: **Send to a tradesman** (routes
  straight to a worker to do the repair) or **Send to a CPM** (a CPM builds a scope,
  which returns to management and then flows to procurement). The routing picker is
  grouped by position with collapsible sections.

## 2b. FIAREP VISION (AI-Assisted Inspection)

- Anyone sent a complaint (inspector or trade worker) can open **FIAREP Vision**
  from the job or the notification.
- Take a photo of the condition; the app's AI (GPT-4o vision) suggests a violation
  classification: A / B / C hazard class, confidence, a suggested HPD code, the
  recommended trade, priority, and a plain-language observation.
- The person confirms as the inspector: **Accept** (saves it as an official
  violation, with the photo attached), **Change A/B/C**, or **Reject**.
- Management sees the AI's classification AND the photo in Inspection Approvals.

## 3. SCOPE OF WORK & ESTIMATES

- **Nature of Work & Cost Estimate** — pick from a scrollable dropdown of 26 work
  categories (General Requirements, Facades, Plumbing, Electrical, Heating, etc.),
  apply a cost to each; auto totals, contingency, and cost-per-unit.
- **Scope of Work (Divisions)** — full CSI MasterFormat (35 divisions, 130+
  sections); CPM builds line items with quantity, unit, and cost.
- CPMs add their own notes separately from the inspector's violation notes.
- Everything exports to a professional **Excel** file (Job ID, contractor, line
  items, sub-totals, grand total, cost per dwelling unit).

## 4. TWO REPAIR TRACKS

**In-house (staff workers):**
- Management assigns a repair to a plumber/electrician/etc.
- Worker sees it in **My Jobs**, does the repair, marks it done with a completion
  note and photos; management is notified. No pricing — workers don't estimate.

**Vendor (contractors):**
- CPM's scope goes to procurement → broadcast to vendors with a walkthrough
  date/time, meeting note, and bid-close date.
- Vendors get a tracking ID, see the scope with internal pricing stripped, and
  submit their own quotes.
- Procurement compares bids, awards the job, rates the finished work, and closes it.

## 5. CHANGE WORK ORDERS

- **CPM change orders** (with cost + photos): for add-on work found on a job.
  Flow: submitted → management approves → procurement approves the cost → done.
  Declined ones come back to the CPM to edit and resubmit the same record.
  Procurement can "View original scope" to validate the change.
- **Worker change orders** (no cost): trades document add-on work with photos;
  management approves directly (no procurement).

## 6. ELEVATOR SERVICE

- Assigning an elevator job generates an **Elevator ID (EL-#####)**.
- The mechanic opens Elevator Services, records each component's condition
  (Good/Repair/Replace/N/A) + notes + photos, and reports progress
  (On my way → Started → Job completion — each greys out and notifies).
- An **Elevator Supervisor** sees an Elevator Dashboard: all jobs searchable by
  address / EL-ID / mechanic, with a progress timeline, report, and photos.

## 7. EMERGENCY UNITS (TRUCKS)

- Admin / Borough Director / Regional Director **register trucks** (each gets a
  unique code) and **assign emergencies** (pick a truck, development, address, the
  location in the building, and the issue → Emergency Job ID EM-#####).
- Address entry is development-aware: pick a development and its known addresses
  appear; type to filter; the database of addresses builds over time.
- Trucks reach a dedicated **Emergency entry** (no login), enter their code, and
  see their jobs instantly — with a persistent alert banner and a repeating alert
  until every job is complete.
- Trucks report On my way / Started / Complete + photos.
- Management/supervisors get a read-only **Emergency Activity** view of what
  happened at their development (truck, timeline, location, address, photos, who
  responded) — emergencies never clutter the inbox.
- **Truck Scores** rank each truck by performance (+ for completed, − for active).

## 8. SCORING & OVERSIGHT

- **Development Scores** — each development scored by its work (completed vs open vs
  overdue), pick one from a dropdown to see its page.
- **Vendor Scores** — contractor performance.
- **Truck Scores** — emergency unit performance.
- **Audit Log** — a filterable record (Hiring, Reports, Assignments, Change Orders,
  Inspections, Elevator) of who did what; pick a category to view.

## 9. STAFF & ACCESS MANAGEMENT

- Administrators (and Regional Directors, minus other admins) issue staff accounts
  with a name, position, and login code; can assign each person to one or more
  **developments**.
- **Multi-development access** — a trade worker can be assigned to several
  developments and their job list respects it.
- **Role-based screens** — supervisors see a restricted tool set; admin-only
  modules (procurement, scores, staff, audit, rates) are hidden from regular
  supervisors; workers and inspectors never see pricing.
- Bulk employee import.

## 10. CROSS-CUTTING

- **Notifications inbox** routes each hand-off to the right person; tapping opens
  the right screen (no dead ends).
- **Address autocomplete** everywhere — recently-used addresses, newest first.
- **Photos** attach throughout (complaints, repairs, elevator, emergency, change
  orders) with full-screen viewing.
- **Role-appropriate deletes** — staff can't delete management-assigned jobs; a
  two-stage "clear then delete" model where it applies.
- Complaint/resident data flows forward through the chain so no one re-enters it.

---

## WHERE IT STANDS
The full workflow above runs on iOS today. The next step for a multi-device,
multi-user pilot is connecting the shared backend so every device sees the same
live data (plus push notifications and cloud photo storage).

*Grivvy Com LLC*
