# FIAREP — changes to apply in the Replit workspace, then Publish

These edits are committed on the Mac repo (`main`, latest `bc78666`) but the
live site (fiarep.com) is still serving the old bundle (`index-LPjX_4Dp.js`
unchanged). Apply them in the Replit workspace that Publish deploys from, then
rebuild + Publish. Nothing here touches money/procurement scope.

## 1. New / renamed trade positions
Trades supported: Plumber, Electrician, Carpenter, Painter, Elevator Service,
**Heating Service** (worker) + **Heating Service Supervisor**, **Bricklayer** +
**Bricklayer Supervisor**. (No separate "Boiler Mechanic" — heating/boiler work
is "Heating Service".)

### a. Shared position enum — `lib/api-client-react/src/generated/api.schemas.ts`
In `export const StaffPosition = { ... }`, reorder so the dropdown reads:
leadership → ALL supervisors → field/trade staff → support. Add
`Heating Service Supervisor`, `Bricklayer`, `Bricklayer Supervisor`. Final order:

Borough Director, Regional Director, Assistant Regional Director, Property Manager,
Assistant Property Manager, Superintendent, Superintendent Ⓔ, Assistant Superintendent,
Housing Assistant, Director,
Supervisor Inspector, CPM Supervisor, Plumbing Supervisor, Plumber Supervisor,
Electrical Supervisor, Electric Supervisor, Elevator Supervisor, Painter Supervisor,
Carpenter Supervisor, Heating Service Supervisor, Bricklayer Supervisor,
Maintenance Supervisor, Grounds Supervisor,
Inspector, CPM, Plumber, Electrician, Elevator Service, Painter, Carpenter,
Heating Service, Bricklayer, Roofer, General Construction, CCTV Installation,
Maintenance Worker, Caretaker, Porter, Laborer, Groundskeeper, Staff Worker,
Administrative Staff, Other Support Staff, Human Resources, Janitorial Staff, Other

### b. Mobile positions — `artifacts/fiarep-mobile/lib/store.ts`
`STAFF_POSITIONS` reordered the same way (supervisors grouped at top), with
`Heating Service Supervisor`, `Bricklayer`, `Bricklayer Supervisor` added and
NO `Boiler Mechanic`.

### c. Mobile trade detection — `artifacts/fiarep-mobile/app/worker-home.tsx`
`isTradeWorker` regex includes: heating service, heat plant, bricklayer,
brick layer, mason (in addition to plumber/electrician/painter/carpenter/etc.).

### d. Trade maps — `artifacts/fiarep-mobile/lib/store.ts` (listAssignableByTrade)
supervisorTrade + sectionForPosition map:
- Heating Service Supervisor / Supervisor Heating Service / Heat Plant Supervisor → "Heating Service"
- Bricklayer Supervisor / Supervisor Bricklayer / Mason Supervisor → "Bricklayer"

## 2. Backend trade support
### `artifacts/api-server/src/lib/domain.ts`
- TRADE_SUPERVISOR_POSITIONS: add "Heating Service Supervisor", "Bricklayer Supervisor".
- TRADE_ASSIGNMENT_BY_SUPERVISOR: add
  Heating Service Supervisor/Supervisor Heating Service/Heat Plant Supervisor → "Heating Service";
  Bricklayer Supervisor/Supervisor Bricklayer/Mason Supervisor → "Bricklayer".
- SUPERVISED_LEAVE_POSITIONS: add Heating Service Supervisor → {Heating Service},
  Bricklayer Supervisor → {Bricklayer}, Painter Supervisor → {Painter}.

### `artifacts/api-server/src/routes/entities.ts` (manpower-requests create)
- allowedTrades: add "Painter", "Heating Service", "Bricklayer".
- supervisorPositions: add
  Painter: [Painter Supervisor, Supervisor Painter];
  "Heating Service": [Heating Service Supervisor, Supervisor Heating Service, Heat Plant Supervisor];
  Bricklayer: [Bricklayer Supervisor, Supervisor Bricklayer, Mason Supervisor].

## 3. Web trade pickers
- `artifacts/fiarep-web/src/pages/scope-review.tsx` and
  `artifacts/fiarep-web/src/pages/trade-requests.tsx`:
  trades = [Inspector, CPM, Plumber, Carpenter, Electrician, Elevator Service,
            Painter, Heating Service, Bricklayer]
- `artifacts/fiarep-web/src/lib/staff-assignment.ts`: add crew sections +
  title families for Heating Service (supervisor "Heating Service Supervisor")
  and Bricklayer (supervisor "Bricklayer Supervisor").

## 4. Supervisors see org-wide Resident Reports  (fixes Eric C showing 0)
### `artifacts/api-server/src/lib/domain.ts`
- Add helper `isManagementSupervisor(actor)` = management role AND position
  includes "supervisor" OR starts with "superintendent".
- Add helper `isSuperintendentE(actor)` = tolerant match for the Ⓔ glyph
  (accepts Ⓔ, "e", "(e)", "[e]", ⓔ) — replace all strict
  `position === "Superintendent Ⓔ"` checks with it.
- `entityDevelopmentAllowed`: for entity "resident-reports", return true when
  `isManagementSupervisor(actor)` (was: only Superintendent Ⓔ).
### `artifacts/api-server/src/lib/hrAuthorization.ts`
- In the routingOnlySupervisor branch, for `resident-reports` return true
  (org-wide) instead of scoping to the supervisor's developments. Building
  violations stay development-scoped.
### `artifacts/api-server/src/routes/scores.ts`
- `seesAllDevelopments = administrator || isElevated(actor) || isManagementSupervisor(actor)`.

## 5. Trade workers can do their jobs
### `artifacts/fiarep-mobile/app/worker-home.tsx`
- Change Work Order button visible to ALL workers (remove the `!isTradeWorker` gate).
### `artifacts/fiarep-mobile/app/my-jobs.tsx`
- In-house job card shows address, unit, location, and the problem description
  (sourceDetails). Section renamed "Assigned trade work".
### `artifacts/fiarep-mobile/lib/store.ts` (createWorkerChangeOrder)
- Upload photos via uploadPhoto(entity "change-orders") and `queueMutation('change-orders', ...)`
  so the change order + photos reach management (was local-only).
### `artifacts/fiarep-mobile/lib/sync.ts`
- worker sync set: add 'change-orders'. emergency sync set: add
  'resident-reports','building-violations','violations','route-assignments'.
- Keep `ensureAllSyncTables` (creates all sync tables before applying records).
### `artifacts/fiarep-mobile/app/_layout.tsx`
- Register project/intake, project/inspection, project/compass in each stack
  that opens project/[id]; register elevator-jobs in the worker stack.

## 6. Emergency-worker resident report access (backend)
### `artifacts/api-server/src/lib/domain.ts`
- canReadEntity: emergency role may also read resident-reports, building-violations,
  violations, route-assignments (record-level filter still scopes to their staff id).
- emergencyRecordAllowed: non-emergency entities return true (governed by assignment filter).
- staffAssignmentRecordAllowed: scope emergency actors by assignedStaffId too.
### assignResidentReport (mobile store.ts)
- When an emergency supervisor dispatches a resident report, also mirror it into
  emergency_jobs tied to the assignee's truck (dedup by sourceReportId).

## After applying
Run `pnpm run build` (typecheck + build all packages), then Publish. Verify on
fiarep.com: the Team position dropdown shows supervisors grouped at top with
Heating Service Supervisor and Bricklayer Supervisor, and a new hashed JS bundle
name (not index-LPjX_4Dp.js).
