# FIAREP Backend

Shared API for FIAREP's inspection, repair, procurement, emergency, and leave workflows.

The customer-facing website and platform name is **FIAREP.COM**. Use “Field Inspection and Repair Estimation Platform” as the supporting product description.

Official logo asset: `attached_assets/logo-logo_1789085394103.webp`. Preserve the blueprint-style F mark, black background, white construction lines, and blue drafting accents; do not recolor or redraw it.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed:fiarep` — seed FIAREP defaults
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `SESSION_SECRET` — signs short-lived access tokens

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — client/server API contract
- `lib/db/src/schema/index.ts` — persistent schema
- `artifacts/api-server/src/routes` — API route modules
- `artifacts/api-server/src/lib/domain.ts` — role, position, code, and pricing rules

## Architecture decisions

- Existing app-generated record IDs remain primary keys for offline merge safety.
- Domain state remains JSON-shaped while tenant/entity/project/development/sync fields are indexed.
- Access tokens are short-lived JWTs; refresh tokens are opaque, hashed, rotated, and revocable.
- Version checks return HTTP 409 for concurrent edits; pull sync uses `updatedAt` cursors.
- Current actor/app mode/remembered staff remain device-local; shared settings live here.

## Product

- Multi-tenant staff login and account lifecycle
- Role-aware CRUD for FIAREP's 25 shared domain record types
- Procurement, inspection, resident-report, emergency, elevator, and leave transitions
- Cross-device cursor sync, notifications, device-token registry, and audit history

## User preferences

- Treat Borough Director as FIAREP's highest authority with full override access.
- Keep ordinary Administrator permissions limited to assigned developments and lower staff; add further Administrator capabilities only when the user defines them.

## Gotchas

- Run API codegen after every OpenAPI change.
- Closed procurement records are immutable.
- Staff role/position changes must increment `sessionVersion`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
