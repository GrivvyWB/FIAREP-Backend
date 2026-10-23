// Command Center tables. Created at boot (create if not exists), like
// notification_reads, so no drizzle push is needed to ship this.
import { sql } from "drizzle-orm";
import { bigserial, boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** A phone allowed to send commands. Two Ed25519 public keys: the device key
 *  signs every request; the confirm key sits behind Face ID and signs approvals. */
export const commandDevices = pgTable("command_devices", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  staffId: text("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  name: text("name").notNull(),
  deviceKey: text("device_key").notNull(),
  confirmKey: text("confirm_key").notNull(),
  status: text("status").notNull(), // pending | active | revoked
  createdAt: ts("created_at").defaultNow().notNull(),
  approvedAt: ts("approved_at"),
  approvedBy: text("approved_by"),
  revokedAt: ts("revoked_at"),
  lastUsedAt: ts("last_used_at"),
});

/** A desktop agent (the Mac). It authenticates with a token shown once. */
export const commandAgents = pgTable("command_agents", {
  id: text("id").primaryKey(),
  /** The organization the computer belongs to ("default" = FIAREP / Platform Control). */
  tenantId: text("tenant_id").notNull().default("default"),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull(), // active | revoked
  info: jsonb("info").$type<Record<string, unknown>>().notNull().default({}),
  tasks: jsonb("tasks").$type<AgentTask[]>().notNull().default([]),
  folders: jsonb("folders").$type<string[]>().notNull().default([]),
  apps: jsonb("apps").$type<string[]>().notNull().default([]),
  lastSeenAt: ts("last_seen_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
  createdBy: text("created_by").notNull(),
  revokedAt: ts("revoked_at"),
});

export type AgentTask = {
  name: string;
  description: string;
  confirm: boolean;
  params: Record<string, { description: string; pattern: string }>;
};

export const commandRuns = pgTable("command_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  staffId: text("staff_id").notNull(),
  deviceId: text("device_id").notNull(),
  threadId: text("thread_id").notNull(),
  text: text("text").notNull(),
  reply: text("reply"),
  status: text("status").notNull(), // running | done | failed
  error: text("error"),
  usage: jsonb("usage").$type<Record<string, number>>().notNull().default({}),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

/** One action the interpreter chose. Reads run straight away; writes wait
 *  for a Face ID signature (when their confirm switch is on). */
export const commandActions = pgTable("command_actions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("default"),
  runId: text("run_id").notNull(),
  staffId: text("staff_id").notNull(),
  deviceId: text("device_id").notNull(),
  action: text("action").notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  target: text("target").notNull(), // "server" or an agent id
  risk: text("risk").notNull(), // read | write
  needsConfirm: boolean("needs_confirm").notNull(),
  // proposed -> (confirmed) -> queued -> running -> done | failed ; or denied / expired
  status: text("status").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: ts("expires_at").notNull(),
  summary: text("summary").notNull(),
  signature: text("signature"),
  result: jsonb("result").$type<unknown>(),
  error: text("error"),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
  confirmedAt: ts("confirmed_at"),
  finishedAt: ts("finished_at"),
});

/** Append-only, hash-chained: each row's hash covers the previous row's hash,
 *  so an edited or deleted row breaks the chain from that point on. */
export const commandAudit = pgTable("command_audit", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  at: ts("at").defaultNow().notNull(),
  /** null = FIAREP / Platform Control (every row before clients had their own). */
  tenantId: text("tenant_id"),
  actor: text("actor").notNull(),
  deviceId: text("device_id"),
  runId: text("run_id"),
  actionId: text("action_id"),
  event: text("event").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});

export const commandWorkOrders = pgTable("command_work_orders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("default"),
  alertId: text("alert_id").notNull(),
  alertKey: text("alert_key").notNull(),
  address: text("address").notNull(),
  borough: text("borough").notNull(),
  company: text("company").notNull(),
  bbl: text("bbl").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  urgency: text("urgency").notNull(), // urgent | routine
  status: text("status").notNull(), // draft | approved | rejected | assigned
  note: text("note"),
  assignedStaffId: text("assigned_staff_id"),
  assignedName: text("assigned_name"),
  bookingId: text("booking_id"),
  trade: text("trade"),
  runId: text("run_id"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export async function ensureCommandTables(): Promise<void> {
  await db.execute(sql`create table if not exists command_devices (
    id text primary key, tenant_id text not null, staff_id text not null, staff_name text not null,
    name text not null, device_key text not null, confirm_key text not null, status text not null,
    created_at timestamptz not null default now(), approved_at timestamptz, approved_by text,
    revoked_at timestamptz, last_used_at timestamptz)`);
  await db.execute(sql`create table if not exists command_agents (
    id text primary key, name text not null, token_hash text not null, status text not null,
    info jsonb not null default '{}', tasks jsonb not null default '[]', folders jsonb not null default '[]',
    apps jsonb not null default '[]', last_seen_at timestamptz, created_at timestamptz not null default now(),
    created_by text not null, revoked_at timestamptz)`);
  await db.execute(sql`create unique index if not exists command_agents_token_idx on command_agents (token_hash)`);
  await db.execute(sql`create table if not exists command_runs (
    id text primary key, tenant_id text not null, staff_id text not null, device_id text not null,
    thread_id text not null, text text not null, reply text, status text not null, error text,
    usage jsonb not null default '{}', created_at timestamptz not null default now(),
    updated_at timestamptz not null default now())`);
  await db.execute(sql`create index if not exists command_runs_thread_idx on command_runs (thread_id, created_at)`);
  await db.execute(sql`create table if not exists command_actions (
    id text primary key, run_id text not null, staff_id text not null, device_id text not null,
    action text not null, params jsonb not null default '{}', target text not null, risk text not null,
    needs_confirm boolean not null, status text not null, nonce text not null, expires_at timestamptz not null,
    summary text not null, signature text, result jsonb, error text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    confirmed_at timestamptz, finished_at timestamptz)`);
  await db.execute(sql`create index if not exists command_actions_run_idx on command_actions (run_id)`);
  await db.execute(sql`create index if not exists command_actions_queue_idx on command_actions (target, status)`);
  await db.execute(sql`create table if not exists command_audit (
    seq bigserial primary key, at timestamptz not null default now(), actor text not null,
    device_id text, run_id text, action_id text, event text not null, detail jsonb not null default '{}',
    prev_hash text not null, hash text not null)`);
  await db.execute(sql`create table if not exists command_work_orders (
    id text primary key, alert_id text not null, alert_key text not null, address text not null,
    borough text not null, company text not null, bbl text not null, kind text not null, title text not null,
    detail text not null, urgency text not null, status text not null, note text, run_id text,
    decided_by text, decided_at timestamptz, created_at timestamptz not null default now())`);
  await db.execute(sql`create unique index if not exists command_work_orders_alert_idx on command_work_orders (alert_id)`);
  // Each client has its own Command Center: everything carries the organization.
  // Rows from before this belong to FIAREP ("default").
  await db.execute(sql`alter table command_agents add column if not exists tenant_id text not null default 'default'`);
  await db.execute(sql`alter table command_actions add column if not exists tenant_id text not null default 'default'`);
  await db.execute(sql`alter table command_work_orders add column if not exists tenant_id text not null default 'default'`);
  await db.execute(sql`alter table command_audit add column if not exists tenant_id text`);
<<<<<<< ours
  for (const col of ["assigned_staff_id", "assigned_name", "booking_id", "trade"]) await db.execute(sql`alter table command_work_orders add column if not exists ${sql.identifier(col)} text`);
  await db.execute(sql`create index if not exists command_runs_tenant_idx on command_runs (tenant_id, created_at)`);
  await db.execute(sql`create index if not exists command_devices_tenant_idx on command_devices (tenant_id)`);
  await db.execute(sql`create index if not exists command_audit_tenant_idx on command_audit (tenant_id, seq)`);
  await db.execute(sql`create table if not exists command_reports (
    id text primary key, tenant_id text not null, title text not null, body text not null,
    created_by text not null, run_id text, created_at timestamptz not null default now())`);
  await db.execute(sql`create index if not exists command_reports_tenant_idx on command_reports (tenant_id, created_at)`);
=======
  await db.execute(sql`create index if not exists command_runs_tenant_idx on command_runs (tenant_id, created_at)`);
  await db.execute(sql`create index if not exists command_devices_tenant_idx on command_devices (tenant_id)`);
  await db.execute(sql`create index if not exists command_audit_tenant_idx on command_audit (tenant_id, seq)`);
>>>>>>> theirs
}
