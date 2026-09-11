# FIAREP — Field Repair and Estimation Platform
### One-Page Overview

**What it is.** FIAREP (Field Repair and Estimation Platform) is an iOS app that runs the full lifecycle of building
repair work — from the moment an inspector spots a problem to the moment a vendor
is awarded the job and paid. It replaces the paper scopes, emailed spreadsheets,
and phone-tag that construction project managers, supervisors, procurement staff,
and outside contractors rely on today.

---

### Who uses it

- **Inspectors / CPMs** — walk the buildings, log issues, and build the scope of
  work.
- **Supervisors / Management** — review and approve the scopes their CPMs submit.
- **Procurement** — send approved scopes out to vendors, collect bids, award the
  job, and close it out.
- **Vendors (contractors)** — receive the job, price it, and submit a quote — no
  login required, just a job ID.
- **Residents** — report issues in their units.

---

### What it does, end to end

**1. Inspect & log.** A supervisor sends an inspector a specific issue to look up
at a given building and unit. The inspector logs building violations against a
built-in code catalog, complete with the official order text and a hazard-class
rating for each. Supervisors can also assign inspectors a route — a list of
addresses to visit, marked reached / not reached as they go.

**2. Build the scope.** The CPM turns an inspection into a Scope of Work using a
standard industry construction framework — dozens of divisions and sections
spanning General Requirements, Masonry, Openings, Plumbing, Electrical, and more.
They pick the divisions and sections the job needs from a dropdown, then add each
line of work with quantity, unit, and cost. The header (contractor, project
manager, number of dwelling units, address, date) auto-fills.

**3. Approve.** The CPM submits the scope to their supervisor, who reviews the
full scope and quote read-only, then approves it to procurement — or returns it
for revision with a note. Nothing moves forward without sign-off.

**4. Send to vendors & collect bids.** Procurement broadcasts the approved job to
their vendor list, setting a walkthrough date/time, a meeting note, and a
bid-close date. Each vendor gets a tracking ID (e.g. sr-14849), opens the job,
sees the scope of work **with the internal pricing stripped out**, and fills in
their own unit costs to produce a quote. Every vendor's bid comes back to
procurement, listed side by side.

**5. Award & close.** Procurement awards the job to the chosen vendor, then rates
the completed work (good / fair / poor), applies any deduction, and closes it out.
Closed jobs stay permanently viewable and are locked against further edits.

---

### What comes out of it

- A professional **Scope of Work spreadsheet** (Excel) in a standard contract
  format — job ID, contractor, full division/section line items, sub-totals,
  grand total, and cost per dwelling unit — ready to email or attach.
- A clean **audit trail** of who submitted, approved, bid, awarded, and closed
  each job, with an in-app notification inbox for every hand-off.
- **Role-appropriate views** — inspectors never see pricing, vendors never see
  the internal estimate, and closed jobs can't be quietly changed.

---

### Where it stands

The full workflow above is built and running on iOS. The next step to support
multiple properties and users at once is connecting the shared backend so every
device sees the same live data.

*Grivvy Com LLC*
