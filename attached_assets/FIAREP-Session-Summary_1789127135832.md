# FIAREP — Everything Built This Session

A complete rundown of what was added and changed, across the iOS app and the
marketing website. Everything is committed to git and typecheck-clean.

---

## 1. FEATURE F — Red-Items Access Restriction
Regular supervisors now see a limited tool set on the management home; admin-only
modules are hidden and reserved for elevated roles.
- **Elevated (see everything):** Administrator, Regional Director, Borough Director,
  Superintendent, and plain Management.
- **Restricted supervisors** keep only: Send Violation, Inspection Approvals, Assign
  Route, Assign a Job, Create Report, Staff Member Jobs, Scope Approvals, Emergency
  Activity, Inbox, Switch role.
- **Hidden from restricted supervisors:** HUD Inspections, Procurement, Change Orders,
  Vendor/Development Scores, Review Reports, Staff Approvals, Bulk Employees, Audit
  Log, Default Rates. Empty sections don't render.

## 2. FEATURE C — Multi-Development Access
- The development multi-picker now shows for ALL staff when issuing an account
  (trade workers included), and saves each person's assigned developments.
- A worker's My Jobs filters to their assigned developments (lenient — untagged jobs
  still show; no developments = sees everything).

## 3. FEATURE D — Emergency Unit System (complete)
- **Admin / Borough Director / Regional Director only:**
  - **Manage Trucks** — register emergency trucks; each gets an auto code (TRK-####).
  - **Assign Emergency Unit** — pick a registered truck, a searchable development,
    a development-scoped address (autocompletes), a location-in-building, and the
    issue → generates an Emergency Job ID (EM-#####).
  - **Truck Scores** — +10 per completed emergency, −5 per active; ranked list plus a
    per-truck dropdown page with history and a Close button.
- **Trucks:** role picker → 🚨 Emergency Unit (no login) → enter their CODE → their
  jobs appear → On my way / Started / Complete + photos. A persistent red banner and
  a repeating 20-second alert run until every job is done.
- **Management + Supervisors:** read-only **Emergency Activity** — which truck
  responded at their development, the timeline, location, address, photos, and who
  responded.
- Emergency updates never clutter the inbox (all in Emergency Activity); a sweep
  clears any leftover emergency notifications on inbox load.

## 4. FIAREP VISION — AI-Assisted Inspection (new)
- Reached from the Job Details page or a violation notification by anyone sent a
  complaint (inspectors and trade workers).
- Take a photo of a condition → GPT-4o vision suggests an A/B/C hazard class,
  confidence, a suggested HPD code, the recommended trade, priority, and a
  plain-language observation.
- The user confirms as the inspector: **Accept** (saves an official violation WITH
  the photo), **Change A/B/C**, or **Reject**.
- Management sees the AI classification AND the photo in Inspection Approvals.
- OpenAI key lives in lib/aiConfig.ts (gitignored, local only) — must move to a
  backend proxy before any public release.

## 5. Approve & Route — Two Paths
When management approves an inspection, they choose:
- **Send to a tradesman** → route picker shows trades → the worker does the repair.
- **Send to a CPM (to scope)** → picker shows only CPMs → the CPM builds a scope,
  which returns to management and then flows to procurement.
The route picker is grouped by position with collapsible sections.

## 6. Delete Lockdown
- Trade workers can NEVER delete anything — no delete controls on any worker screen.
- Only management/admin can delete notifications; everyone else is blocked.

## 7. LEAVE MANAGEMENT SYSTEM (new — app + website)
Development-level employee time-off tracking.
- **Request Time Off** (workers for themselves; management for any employee):
  - Employee name autocompletes from staff; picking one auto-fills title, development,
    and the development's supervisor.
  - Scroll date pickers for start/end (year range extends ~30 years out — no typing,
    no invalid dates).
  - "Amount of time" is a picker: Full day(s), Quarter day (2h), Half day (4h),
    Three-quarter day (6h), or 1/3/5/7 hours.
  - Live remaining balances shown (auto-calculated from annual allotments; 8h = 1 day).
  - Nine leave categories: Vacation, Sick, Childcare, Personal, LOA, Family Emergency,
    Jury Duty, Bereavement, Other.
- **Leave Calendar dashboard** (management/admin):
  - Month grid with prev/next, today highlighted (accent ring), leave color-coded by
    type (approved solid, pending faded), tap a day to see who's out.
  - **US holidays marked** (★): New Year's Day, MLK Day, Presidents' Day, Memorial
    Day, Juneteenth, Independence Day, Labor Day, Columbus/Indigenous Peoples Day,
    Veterans Day, Election Day, Thanksgiving, Christmas Day — computed for any year.
  - Filterable list (development, status, search), Approve/Deny, overlap conflict
    alerts (⚠️ when approved leaves overlap in a development), days-or-hours display.
- **Everything stays in the platform — nothing is emailed.** Employees check the app
  to see if their request was approved; management sees requests in the app.

## 8. Website Leave Page (leave.html)
A matching leave-management page for the marketing website, styled to the site
(yellow accent, Inter, sidebar app shell). Includes the stats row, the team calendar
(same holidays + color coding), the request form, and the requests table with
approve/deny — using demo data (browser localStorage) until the shared backend is
wired. It mirrors the app's logic so the two stay consistent.

## 9. Other Refinements
- Address autocomplete everywhere (recency-ordered, up to 10 matches);
  development-scoped variant for emergencies.
- Regional Director role (management account) can issue/delete everyone except
  administrators.
- Staff position hierarchy reordered (Regional Director → Borough Director → Property
  Manager → … → trades → Other); added Property Manager, Assistant PM, Borough
  Director, Assistant Superintendent, Housing Assistant, Groundskeeper, Janitorial
  Staff.
- Development Scores per-development dropdown; Audit Log category dropdown; Nature of
  Work single-category dropdown.
- Complaint "Send as Complaint" now reaches all trades + inspectors; RC- complaint
  number carries through the chain.
- Staff Approvals shows each person's development.

---

## APP vs WEBSITE — how they connect
The iOS app and the website are currently **separate** — they can look and behave the
same, but they don't share live data yet. Both will point at the same records once
the shared backend is wired (the #1 item for a real multi-user pilot). Until then the
website page uses demo data in the browser.

## STILL TO DO (highlights)
- Backend: cross-device sync, push notifications, cloud photo storage, server-side
  role enforcement, OpenAI proxy for FIAREP Vision.
- Leave reports + exports (history, staffing impact, monthly absence, upcoming,
  overtime risk → PDF/Excel/CSV).
- Resident-data threading further downstream; procurement payout stages.

*Grivvy Com LLC*

---

## 10. Hierarchy & Leave-Tier (later this session)
- **Borough Director** is now the top of the position hierarchy (order: Borough
  Director → Regional Director → Property Manager → Assistant Property Manager →
  Superintendent → Assistant Superintendent → then the rest). Administrator moved
  down in the list (powers unchanged).
- The admin-section **header bar** now shows the logged-in person's title (Borough
  Director, Regional Director, etc.) instead of always "Administrator."
- On the **Leave Calendar**, a Borough Director sees ONLY management-tier requests
  (Borough Dir, Regional Dir, Property Mgr, Assistant PM, Superintendent, Assistant
  Superintendent) — lower staff are hidden so he isn't flooded.

## 11. Anti-Flooding UI — Collapsible Sections & Close Buttons
- Long lists are now collapsible (tap a header showing a count) so screens don't
  flood: Manage Requests (Reports / Change Orders / Notifications), Scope Approvals
  (Awaiting / Returned), Change Orders (Needs action / History), Resident Reports
  (collapsible Reports list). Procurement already had this.
- Close buttons added to the dropdown screens: Development Scores, Truck Scores,
  Audit Log, and the Resident Reports development filter.

## 12. Leave — My Requests
- Workers (and supervisors/trades) get a **My Requests** button on the Request Time
  Off screen showing their own requests with colored status badges (Approved / Denied
  / Pending) — so they check the app to see if their time off was approved. Nothing
  is emailed.

## 13. Two-Stage Delete Restored (worker + management)
- Workers can't delete assigned jobs on their own. Management clears a finished job
  first — "Clear for staff" on Inspection Approvals (inspection jobs) or "Clear for
  worker" on Resident Reports (resolved, assigned resident jobs). Once cleared, the
  worker sees "Remove (cleared by management)" in My Jobs and can remove it. The
  record stays for reporting.
