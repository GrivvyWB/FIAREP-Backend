import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
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

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    staffLimit: integer("staff_limit"),
    propertyLimit: integer("property_limit"),
    features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
    unrestricted: boolean("unrestricted").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("organization_status_idx").on(table.status),
  ],
);

/**
 * Normalized, append-only time-clock punches.  External integrations and the
 * FIAREP mobile clock both write the same shape so downstream consumers never
 * need vendor-specific logic.  There is intentionally no update endpoint for
 * this table: imported punches are authoritative and read-only to staff.
 */
export const timeClockPunches = pgTable(
  "time_clock_punches",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    staffId: text("staff_id").notNull(),
    source: text("source").$type<"external" | "fiarep-mobile">().notNull(),
    direction: text("direction").$type<"in" | "out">().notNull(),
    punchAt: timestamp("punch_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    provider: text("provider"),
    externalId: text("external_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps,
  },
  (table) => [
    check("time_clock_punch_source_check", sql`${table.source} in ('external', 'fiarep-mobile')`),
    check("time_clock_punch_direction_check", sql`${table.direction} in ('in', 'out')`),
    check(
      "time_clock_punch_origin_fields_check",
      sql`(${table.source} = 'external' and ${table.provider} is not null and ${table.externalId} is not null)
        or (${table.source} = 'fiarep-mobile' and ${table.provider} is null and ${table.externalId} is null)`,
    ),
    uniqueIndex("time_clock_punch_idempotency_unique").on(table.tenantId, table.idempotencyKey),
    uniqueIndex("time_clock_punch_external_unique").on(
      table.tenantId,
      table.source,
      table.provider,
      table.externalId,
    ),
    index("time_clock_punch_staff_idx").on(table.tenantId, table.staffId, table.punchAt),
    index("time_clock_punch_tenant_idx").on(table.tenantId, table.punchAt),
  ],
);

export const organizationProperties = pgTable(
  "organization_properties",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    displayAddress: text("display_address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    development: text("development"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organization_property_address_unique").on(table.normalizedAddress),
    index("organization_property_org_idx").on(table.organizationId),
    index("organization_property_active_idx").on(table.active),
  ],
);

export const publicAccessCodes = pgTable(
  "public_access_codes",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    tenantId: text("tenant_id").notNull(),
    recordId: text("record_id").notNull(),
    tokenHash: text("token_hash"),
    propertyId: text("property_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("public_access_code_unique").on(table.code),
    index("public_access_tenant_record_idx").on(table.tenantId, table.recordId),
  ],
);

export const residentReportPhotos = pgTable(
  "resident_report_photos",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reportId: text("report_id").notNull(),
    objectPath: text("object_path").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("resident_report_photo_path_unique").on(table.objectPath),
    index("resident_report_photo_report_idx").on(table.tenantId, table.reportId),
  ],
);

export const residentPhotoUploadGrants = pgTable(
  "resident_photo_upload_grants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reportId: text("report_id").notNull(),
    objectPath: text("object_path").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("resident_photo_grant_path_unique").on(table.objectPath),
    index("resident_photo_grant_report_idx").on(table.tenantId, table.reportId),
  ],
);

/**
 * Immutable ownership metadata for private object-storage files. The
 * entity's JSON state may be edited by clients, so it is never used as the
 * source of truth for file authorization.
 */
export const fileOwnership = pgTable(
  "file_ownership",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    objectPath: text("object_path").notNull(),
    entity: text("entity").notNull(),
    recordId: text("record_id").notNull(),
    createdBy: text("created_by").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("file_ownership_tenant_path_unique").on(
      table.tenantId,
      table.objectPath,
    ),
    index("file_ownership_record_idx").on(
      table.tenantId,
      table.entity,
      table.recordId,
    ),
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

export const platformOwnerSessions = pgTable(
  "platform_owner_sessions",
  {
    id: text("id").primaryKey(),
    ownerName: text("owner_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("platform_owner_token_unique").on(table.tokenHash),
    index("platform_owner_session_expiry_idx").on(table.expiresAt),
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

/**
 * Immutable vendor presence evidence for scheduled procurement walk-throughs.
 * The server receipt time is authoritative; capturedAt records device time.
 */
export const vendorWalkthroughCheckIns = pgTable(
  "vendor_walkthrough_check_ins",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    procurementId: text("procurement_id").notNull(),
    trackingId: text("tracking_id").notNull(),
    vendorName: text("vendor_name").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracy: doublePrecision("accuracy"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("vendor_walkthrough_check_in_scope_idx").on(table.tenantId, table.procurementId),
    index("vendor_walkthrough_check_in_received_idx").on(table.tenantId, table.receivedAt),
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

export const platformLicenseAudit = pgTable(
  "platform_license_audit",
  {
    id: text("id").primaryKey(),
    ownerName: text("owner_name").notNull(),
    action: text("action").notNull(),
    organizationId: text("organization_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("platform_license_audit_org_idx").on(table.organizationId),
    index("platform_license_audit_at_idx").on(table.at),
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

export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    notificationId: text("notification_id").notNull(),
    tokenId: text("token_id"),
    staffId: text("staff_id"),
    status: text("status").notNull(),
    ticketId: text("ticket_id"),
    errorCode: text("error_code"),
    detail: text("detail"),
    receiptAttempts: integer("receipt_attempts").notNull().default(0),
    nextReceiptCheckAt: timestamp("next_receipt_check_at", {
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("push_delivery_notification_idx").on(
      table.tenantId,
      table.notificationId,
    ),
    index("push_delivery_status_idx").on(table.tenantId, table.status),
    index("push_receipt_queue_idx").on(
      table.status,
      table.nextReceiptCheckAt,
    ),
  ],
);

export type StaffAccount = typeof staffAccounts.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type OrganizationProperty = typeof organizationProperties.$inferSelect;
export type EntityRecord = typeof entityRecords.$inferSelect;
export type TimeClockPunch = typeof timeClockPunches.$inferSelect;