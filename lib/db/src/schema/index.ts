import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const staffAccounts = pgTable(
  "staff_accounts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    name: text("name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    position: text("position").notNull(),
    role: text("role").notNull(),
    code: text("code").notNull(),
    status: text("status").notNull().default("approved"),
    developments: jsonb("developments").$type<string[]>().notNull().default([]),
    createdBy: text("created_by"),
    issuerName: text("issuer_name"),
    sessionVersion: integer("session_version").notNull().default(1),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("staff_login_unique").on(table.tenantId, table.name, table.code),
    index("staff_tenant_idx").on(table.tenantId),
    index("staff_status_idx").on(table.status),
  ],
);

export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: text("id").primaryKey(),
    staffId: text("staff_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("refresh_token_unique").on(table.tokenHash),
    index("refresh_staff_idx").on(table.staffId),
  ],
);

/**
 * Entity records intentionally preserve the iOS app's JSON-shaped state while
 * indexing the fields used by server-side filtering and sync.
 */
export const entityRecords = pgTable(
  "entity_records",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    entity: text("entity").notNull(),
    projectId: text("project_id"),
    development: text("development"),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by"),
    deleted: boolean("deleted").notNull().default(false),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("entity_lookup_idx").on(table.tenantId, table.entity),
    index("entity_project_idx").on(table.tenantId, table.projectId),
    index("entity_updated_idx").on(table.tenantId, table.updatedAt),
    index("entity_development_idx").on(table.tenantId, table.development),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    target: text("target").notNull(),
    message: text("message").notNull(),
    detail: text("detail"),
    reportId: text("report_id"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    read: boolean("read").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("notification_target_idx").on(table.tenantId, table.target),
    index("notification_unread_idx").on(table.tenantId, table.read),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    actorRole: text("actor_role").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
    reportId: text("report_id"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    index("audit_tenant_idx").on(table.tenantId),
    index("audit_at_idx").on(table.tenantId, table.at),
  ],
);

export const settings = pgTable(
  "settings",
  {
    tenantId: text("tenant_id").notNull().default("default"),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    ...timestamps,
  },
  (table) => [uniqueIndex("setting_unique").on(table.tenantId, table.key)],
);

export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    staffId: text("staff_id").notNull(),
    token: text("token").notNull(),
    platform: text("platform"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("device_token_unique").on(table.tenantId, table.token),
    index("device_staff_idx").on(table.tenantId, table.staffId),
  ],
);

export type StaffAccount = typeof staffAccounts.$inferSelect;
export type EntityRecord = typeof entityRecords.$inferSelect;