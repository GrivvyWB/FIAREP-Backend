---
name: FIAREP authority hierarchy
description: The confirmed authority ordering and rule for expanding Administrator permissions.
---

Borough Director is FIAREP's highest operational authority across staff and developments, except Procurement. Procurement is an isolated authority domain with a concealed two-step website sign-in; Borough Director and Administrators cannot view, create, edit, delete, approve, release, award, or close Procurement records.

Ordinary Management and Administrators may see all operational records only inside developments assigned to their account. An empty development list grants no operational visibility. Do not infer or add further Administrator capabilities; define them incrementally as the user specifies them.

Public Resident complaints go to Management for internal routing. The reporter does not need to be a tenant or belong to the development, and the Borough Director must always receive and see every complaint within the organization regardless of development assignment.

Emergency Unit is an explicit issued-code staff identity, not a Worker mode. Emergency records and actions must remain assignment-scoped across normal reads, synchronization, and workflow actions.

Operational staff assignment follows development-based groups. Ordinary Management assigns scoped Workers, Inspectors, and Emergency staff; Regional Directors may also assign scoped Management; Borough Directors may assign across the operational group. Procurement, Residents, Vendors, the assigning user, and other Borough Directors never belong in operational assignment lists.

Trade crews are grouped automatically by position: Plumber Supervisor with Plumbers, Electric Supervisor with Electricians, Elevator Supervisor with Elevator Service, Painter Supervisor with Painters, and Carpenter Supervisor with Carpenters. Supervisors appear first in their section.

Website modules and direct routes follow staff authority, not a shared menu. Inspectors have the complete violations capability; Elevator Service, Elevator Supervisor, and CPM inspectors have the Elevator capability; CPM inspectors have full scope drafting/editing/submission. Management and supervisors approve completed staff work online within their development scope.

Submitted CPM requests for a development with no assigned Management account intentionally remain hidden until Platform Control assigns that development to Management.

CPM may prepare and submit only its own scope/request to ordinary Management. Ordinary Management—not Administrator, Borough Director, Regional Director, or Superintendent—may return it to CPM or approve it for Procurement. Procurement sees it only after Management approval and alone may release it to vendors, select a real vendor bid, award, and close it.

**Why:** The user explicitly confirmed that Borough Director ranks above Administrator, then explicitly excluded Procurement from Borough Director authority and required Procurement-only control. The user also required Management to handle its own team and Borough Directors to handle their operational group.

**How to apply:** Check Procurement boundaries before any Borough Director override in list, sync, create, update, delete, workflow-action authorization, and assignment candidate generation. Apply role and position gates to server reads/writes/actions, sync, menus, dashboard requests, quick actions, and direct routes. Use shared developments to define ordinary Management and Regional Director assignment groups. Fail closed for ordinary Management and Administrators when a record has no development or no assigned-development match. Generate trade sections from staff positions rather than manually linking individual employees to supervisors. Keep final work approval distinct from earlier routing approval so completed work cannot re-enter the workflow. Never apply development filtering to Borough Director access for Resident complaints; Management receives new complaints and routes them to the proper development or staff. Enforce lifecycle visibility: CPM owns draft/submitted/returned, ordinary Management sees submitted, Procurement sees approved/downstream, and Vendor sees only released scopes by capability code. Keep Procurement labels and links out of the public staff login and mobile. Only valid Procurement credentials on the ordinary form may open the separate verification form; a direct visit must return to ordinary sign-in. Mask access-code characters on both forms. The second form requires the same credentials plus a displayed, server-generated two-digit number that the user retypes; hide that displayed number after five seconds. The short-lived challenge is bound to that Procurement account, and no session is issued until it succeeds.