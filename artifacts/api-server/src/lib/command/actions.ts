// The Command Center's fixed list of actions. The interpreter can only pick
// from this list and fill in parameters; nothing else can run. Each action is
// switched on/off in Platform Control, and "write" actions wait for a Face ID
// approval unless their confirm switch is turned off.
import { randomUUID } from "node:crypto";
import os from "node:os";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { checkAllWatched } from "../../routes/alerts";
import { lookupNycPropertyData } from "../nycProperty";
import { commandAgents, commandWorkOrders, type AgentTask } from "./tables";
import { onlineAgents, ONLINE_WINDOW_MS } from "./agentBus";
import { recentAudit } from "./audit";

export type ActionContext = { runId: string; staffId: string; deviceId: string; actorName: string };
export type Risk = "read" | "write";

export type ActionDef = {
  name: string;
  label: string; // shown in Platform Control and on approval cards
  description: string; // given to the interpreter
  risk: Risk;
  confirmDefault: boolean;
  target: "server" | "agent";
  schema: Record<string, unknown>;
  /** Server actions only. */
  run?: (params: Record<string, unknown>, ctx: ActionContext) => Promise<unknown>;
  /** One line for the approval card. */
  describe: (params: Record<string, unknown>) => string;
  /** Optional richer line, looked up when the action is proposed. */
  describeLive?: (params: Record<string, unknown>) => Promise<string | null>;
  /** Spoken line after it ran (writes, which don't go back through the interpreter). */
  spoken?: (result: unknown) => string;
};

const ALERT = "violation-alerts";
const WATCH = "watch-buildings";
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const strList = (v: unknown, max = 200) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, max) : []);

type AlertState = { watchId: string; kind: string; key: string; date: string; address: string; borough: string; company: string; bbl: string; title: string; detail: string; seen: boolean; foundAt: string };

/** Urgent = what the City itself treats as immediately hazardous: HPD Class C,
 *  HPD emergency complaints, DOB / ECB items marked hazardous, unsafe or immediate. */
export function alertUrgency(a: { kind: string; title: string; detail: string }): "urgent" | "routine" {
  const title = a.title.toUpperCase();
  const all = `${title} ${a.detail.toUpperCase()}`;
  if (a.kind === "HPD complaint" && all.includes("(EMERGENCY)")) return "urgent";
  if (a.kind === "HPD violation" && /^CLASS C\b/.test(title)) return "urgent";
  if ((a.kind === "DOB violation" || a.kind === "OATH / ECB summons") &&
    (/(^|[^-])\bHAZARDOUS\b/.test(all) || /CLASS - 1\b|UNSAFE|IMMEDIATE|IMEGNCY/.test(all))) return "urgent";
  return "routine";
}

async function alertRows(scope: "unseen" | "all", limit: number, address?: string) {
  const rows = await db.select().from(entityRecords)
    .where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false),
      scope === "unseen" ? sql`${entityRecords.state}->>'seen' is distinct from 'true'` : sql`true`,
      address ? sql`upper(${entityRecords.state}->>'address') like ${`%${address.toUpperCase()}%`}` : sql`true`))
    .orderBy(desc(entityRecords.createdAt)).limit(limit);
  return rows.map((r) => {
    const s = r.state as unknown as AlertState;
    return { id: r.id, kind: s.kind, date: s.date, address: s.address, borough: s.borough, company: s.company, bbl: s.bbl, title: s.title, detail: s.detail.slice(0, 240), seen: s.seen === true, urgency: alertUrgency(s), key: s.key, foundAt: s.foundAt };
  });
}

function summarizeAlerts(items: Awaited<ReturnType<typeof alertRows>>) {
  const urgent = items.filter((a) => a.urgency === "urgent");
  const byBuilding = new Map<string, { address: string; company: string; urgent: number; routine: number }>();
  for (const a of items) {
    const b = byBuilding.get(a.address) ?? { address: a.address, company: a.company, urgent: 0, routine: 0 };
    b[a.urgency] += 1; byBuilding.set(a.address, b);
  }
  return {
    total: items.length, urgent: urgent.length, routine: items.length - urgent.length,
    byBuilding: [...byBuilding.values()].sort((x, y) => y.urgent - x.urgent || (y.urgent + y.routine) - (x.urgent + x.routine)).slice(0, 25),
    top: [...urgent, ...items.filter((a) => a.urgency === "routine")].slice(0, 15)
      .map(({ id, kind, date, address, title, urgency }) => ({ id, kind, date, address, title, urgency })),
  };
}

async function draftWorkOrders(alertIds: string[], urgentOnly: boolean, ctx: ActionContext) {
  const items = alertIds.length
    ? (await alertRows("all", 2000)).filter((a) => alertIds.includes(a.id))
    : (await alertRows("unseen", 2000)).filter((a) => !urgentOnly || a.urgency === "urgent");
  const existing = items.length
    ? new Set((await db.select({ alertId: commandWorkOrders.alertId }).from(commandWorkOrders).where(inArray(commandWorkOrders.alertId, items.map((a) => a.id)))).map((r) => r.alertId))
    : new Set<string>();
  const fresh = items.filter((a) => !existing.has(a.id));
  for (const a of fresh) {
    await db.insert(commandWorkOrders).values({
      id: randomUUID(), alertId: a.id, alertKey: a.key, address: a.address, borough: a.borough, company: a.company, bbl: a.bbl,
      kind: a.kind, title: a.title, detail: a.detail, urgency: a.urgency, status: "draft", runId: ctx.runId,
    }).onConflictDoNothing();
  }
  return { drafted: fresh.length, alreadyDrafted: items.length - fresh.length, urgent: fresh.filter((a) => a.urgency === "urgent").length };
}

const agentProp = { agent: { type: "string", description: "Agent name (the computer). Omit when only one agent is online." } };

export const ACTIONS: ActionDef[] = [
  // ── Buildings & violations ──────────────────────────────────────────────
  {
    name: "violation_sweep", label: "Check every watched building", risk: "read", confirmDefault: false, target: "server",
    description: "Check every watched client building against NYC Open Data right now (HPD complaints and violations, DOB violations, OATH/ECB summonses, 311), then summarize everything not yet marked seen: totals, urgent vs routine, by building, and the top items. Use for 'check every building', 'any new violations'.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const check = await checkAllWatched();
      const watched = await db.select({ n: sql<number>`count(*)::int` }).from(entityRecords).where(and(eq(entityRecords.entity, WATCH), eq(entityRecords.deleted, false)));
      return { checkedNow: check, watchedBuildings: watched[0]?.n ?? 0, note: check.checked === 0 && check.errors === 0 ? "A sweep was already running; showing current results." : undefined, unseen: summarizeAlerts(await alertRows("unseen", 2000)) };
    },
    describe: () => "Check every watched building now",
  },
  {
    name: "list_alerts", label: "List violation alerts", risk: "read", confirmDefault: false, target: "server",
    description: "List violation alerts already found on watched buildings, optionally only unseen and/or one address. Each has an id usable with prepare_work_orders and mark_alerts_seen.",
    schema: { type: "object", properties: { scope: { type: "string", enum: ["unseen", "all"] }, address: { type: "string", description: "Part of the street address" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    run: async (p) => alertRows(p["scope"] === "all" ? "all" : "unseen", num(p["limit"], 30, 1, 100), str(p["address"], 120) || undefined),
    describe: () => "List alerts",
  },
  {
    name: "property_lookup", label: "Look up an NYC address (HPD / DOB)", risk: "read", confirmDefault: false, target: "server",
    description: "Look up one New York City address live: HPD violations, DOB violations and HPD complaints, with open counts.",
    schema: { type: "object", properties: { address: { type: "string" } }, required: ["address"], additionalProperties: false },
    run: async (p) => {
      const r = await lookupNycPropertyData(str(p["address"], 200), 25);
      if (!r) return { error: "That address could not be matched to an NYC property." };
      return { property: r.property, summary: r.summary, warnings: r.warnings,
        openHpd: r.hpdViolations.filter((v) => !/close|resolved/i.test(v.status)).slice(0, 15).map((v) => ({ class: v.class, apt: v.apartment, description: v.description.slice(0, 160), date: v.inspectionDate })),
        openDob: r.dobViolations.filter((v) => v.status === "Open").slice(0, 10).map((v) => ({ type: v.type, description: v.description.slice(0, 160), date: v.issueDate })) };
    },
    describe: (p) => `Look up ${str(p["address"])}`,
  },
  {
    name: "complaint_feed", label: "Resident complaints across clients", risk: "read", confirmDefault: false, target: "server",
    description: "Most recent resident complaints at every client FIAREP serves, with their status.",
    schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (p) => {
      const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false), sql`${entityRecords.tenantId} <> 'default'`))
        .orderBy(desc(entityRecords.createdAt)).limit(num(p["limit"], 20, 1, 50));
      const orgs = new Map((await db.select({ id: organizations.id, name: organizations.name }).from(organizations)).map((o) => [o.id, o.name]));
      return rows.map((r) => {
        const s = r.state as Record<string, unknown>;
        return { id: r.id, client: orgs.get(r.tenantId) ?? r.tenantId, development: r.development, status: str(s["status"], 40), category: str(s["category"] ?? s["type"], 80), address: str(s["address"] ?? s["building"], 120), apartment: str(s["apartment"] ?? s["unit"], 20), createdAt: r.createdAt };
      });
    },
    describe: () => "Recent resident complaints",
  },
  {
    name: "list_work_orders", label: "List work orders", risk: "read", confirmDefault: false, target: "server",
    description: "List work orders prepared from violation alerts, by status (draft = waiting for approval).",
    schema: { type: "object", properties: { status: { type: "string", enum: ["draft", "approved", "rejected", "any"] } }, additionalProperties: false },
    run: async (p) => {
      const status = str(p["status"], 20) || "draft";
      const rows = await db.select().from(commandWorkOrders).where(status === "any" ? sql`true` : eq(commandWorkOrders.status, status)).orderBy(desc(commandWorkOrders.createdAt)).limit(100);
      return rows.map((w) => ({ id: w.id, status: w.status, urgency: w.urgency, address: w.address, kind: w.kind, title: w.title, createdAt: w.createdAt }));
    },
    describe: () => "List work orders",
  },
  {
    name: "prepare_work_orders", label: "Prepare work orders from alerts", risk: "write", confirmDefault: false, target: "server",
    description: "Draft work orders (status draft, waiting for approval) from violation alerts: either the given alert ids, or every unseen alert (urgentOnly to limit to urgent). Drafting does not send anything to anyone.",
    schema: { type: "object", properties: { alertIds: { type: "array", items: { type: "string" } }, urgentOnly: { type: "boolean" } }, additionalProperties: false },
    run: async (p, ctx) => draftWorkOrders(strList(p["alertIds"]), p["urgentOnly"] === true, ctx),
    describe: (p) => strList(p["alertIds"]).length ? `Draft work orders for ${strList(p["alertIds"]).length} alert(s)` : `Draft work orders for every unseen${p["urgentOnly"] === true ? " urgent" : ""} alert`,
    spoken: (r) => { const x = r as { drafted: number; urgent: number }; return `${x.drafted} work order${x.drafted === 1 ? "" : "s"} prepared for approval, ${x.urgent} urgent.`; },
  },
  {
    name: "decide_work_order", label: "Approve / reject a work order", risk: "write", confirmDefault: true, target: "server",
    description: "Approve or reject one drafted work order by id.",
    schema: { type: "object", properties: { workOrderId: { type: "string" }, decision: { type: "string", enum: ["approve", "reject"] }, note: { type: "string" } }, required: ["workOrderId", "decision"], additionalProperties: false },
    run: async (p, ctx) => {
      const id = str(p["workOrderId"], 80);
      const status = p["decision"] === "approve" ? "approved" : "rejected";
      const [row] = await db.update(commandWorkOrders).set({ status, note: str(p["note"], 500) || null, decidedBy: ctx.actorName, decidedAt: new Date() })
        .where(and(eq(commandWorkOrders.id, id), eq(commandWorkOrders.status, "draft"))).returning();
      if (!row) return { error: "No draft work order with that id." };
      return { id: row.id, status: row.status, address: row.address, title: row.title };
    },
    describe: (p) => `${p["decision"] === "approve" ? "Approve" : "Reject"} work order ${str(p["workOrderId"], 12)}…`,
    describeLive: async (p) => {
      const [w] = await db.select().from(commandWorkOrders).where(eq(commandWorkOrders.id, str(p["workOrderId"], 80))).limit(1);
      return w ? `${p["decision"] === "approve" ? "Approve" : "Reject"} work order — ${w.address} · ${w.title}` : null;
    },
    spoken: (r) => { const x = r as { status?: string; address?: string; error?: string }; return x.error ?? `Work order ${x.status} for ${x.address}.`; },
  },
  {
    name: "mark_alerts_seen", label: "Mark alerts seen", risk: "write", confirmDefault: true, target: "server",
    description: "Mark violation alerts as seen (they stop showing red). Give alert ids, or all=true for every unseen alert.",
    schema: { type: "object", properties: { alertIds: { type: "array", items: { type: "string" } }, all: { type: "boolean" } }, additionalProperties: false },
    run: async (p) => {
      const ids = strList(p["alertIds"], 2000);
      const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false),
        sql`${entityRecords.state}->>'seen' is distinct from 'true'`, p["all"] === true ? sql`true` : ids.length ? inArray(entityRecords.id, ids) : sql`false`));
      const now = new Date();
      for (const r of rows) await db.update(entityRecords).set({ state: { ...r.state, seen: true }, updatedAt: now }).where(eq(entityRecords.id, r.id));
      return { marked: rows.length };
    },
    describe: (p) => p["all"] === true ? "Mark every unseen alert seen" : `Mark ${strList(p["alertIds"]).length} alert(s) seen`,
    spoken: (r) => `${(r as { marked: number }).marked} alerts marked seen.`,
  },
  // ── FIAREP server ───────────────────────────────────────────────────────
  {
    name: "server_status", label: "FIAREP server status", risk: "read", confirmDefault: false, target: "server",
    description: "Health of the FIAREP API right now: uptime, memory, database round-trip, alert checker, desktop agents online.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const t0 = Date.now(); let dbOk = true; let dbError = "";
      try { await db.execute(sql`select 1`); } catch (e) { dbOk = false; dbError = e instanceof Error ? e.message : "failed"; }
      const dbMs = Date.now() - t0;
      const lastCheck = await db.select({ at: sql<string>`max(${entityRecords.state}->>'lastCheckedAt')`, errors: sql<number>`count(*) filter (where coalesce(${entityRecords.state}->>'lastError','') <> '')::int` })
        .from(entityRecords).where(and(eq(entityRecords.entity, WATCH), eq(entityRecords.deleted, false)));
      const agents = await db.select({ name: commandAgents.name, lastSeenAt: commandAgents.lastSeenAt }).from(commandAgents).where(eq(commandAgents.status, "active"));
      const mem = process.memoryUsage();
      return {
        api: { up: true, uptimeMinutes: Math.round(process.uptime() / 60), node: process.version, rssMb: Math.round(mem.rss / 1e6), heapUsedMb: Math.round(mem.heapUsed / 1e6), host: os.hostname(), load1m: os.loadavg()[0] },
        database: { ok: dbOk, roundTripMs: dbMs, error: dbError || undefined },
        alertChecker: { lastCheckedAt: lastCheck[0]?.at ?? null, buildingsWithErrors: lastCheck[0]?.errors ?? 0 },
        agents: agents.map((a) => ({ name: a.name, online: !!a.lastSeenAt && Date.now() - a.lastSeenAt.getTime() < ONLINE_WINDOW_MS, lastSeenAt: a.lastSeenAt })),
      };
    },
    describe: () => "Server status",
  },
  {
    name: "restart_api", label: "Restart the FIAREP API", risk: "write", confirmDefault: true, target: "server",
    description: "Restart the FIAREP API process: it exits a few seconds after answering and its supervisor (Replit deployment / PM2) starts it again. Only when Tim asks to restart or fix a stuck API.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      setTimeout(() => process.exit(0), 2_000).unref();
      return { restarting: true, inSeconds: 2 };
    },
    describe: () => "Restart the FIAREP API",
    spoken: () => "Restarting the API. It should be back in under a minute.",
  },
  {
    name: "audit_recent", label: "Read the command audit trail", risk: "read", confirmDefault: false, target: "server",
    description: "The most recent Command Center audit entries (who ran what, approvals, results).",
    schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (p) => (await recentAudit(num(p["limit"], 15, 1, 50))).map((r) => ({ at: r.at, actor: r.actor, event: r.event, detail: r.detail })),
    describe: () => "Read audit trail",
  },
  // ── Desktop agent (the Mac) ─────────────────────────────────────────────
  {
    name: "desktop_status", label: "Computer status", risk: "read", confirmDefault: false, target: "agent",
    description: "Status of a desktop agent's computer: uptime, load, memory, disk, battery, its tasks.",
    schema: { type: "object", properties: { ...agentProp }, additionalProperties: false },
    describe: (p) => `Status of ${str(p["agent"]) || "the computer"}`,
  },
  {
    name: "desktop_list_folder", label: "List a folder on the computer", risk: "read", confirmDefault: false, target: "agent",
    description: "List files in a folder on the computer. Only folders the agent's config allows (and their subfolders).",
    schema: { type: "object", properties: { ...agentProp, path: { type: "string" } }, required: ["path"], additionalProperties: false },
    describe: (p) => `List ${str(p["path"])}`,
  },
  {
    name: "desktop_read_file", label: "Read a file on the computer", risk: "read", confirmDefault: false, target: "agent",
    description: "Read a text file (first 20 KB) on the computer. Only inside folders the agent's config allows.",
    schema: { type: "object", properties: { ...agentProp, path: { type: "string" } }, required: ["path"], additionalProperties: false },
    describe: (p) => `Read ${str(p["path"])}`,
  },
  {
    name: "desktop_open_app", label: "Open an app on the computer", risk: "write", confirmDefault: true, target: "agent",
    description: "Open an application on the computer. Only apps listed in the agent's config.",
    schema: { type: "object", properties: { ...agentProp, app: { type: "string" } }, required: ["app"], additionalProperties: false },
    describe: (p) => `Open ${str(p["app"])}`,
    spoken: (r) => ((r as { ok?: boolean })?.ok ? "Opened." : "It didn't open — check the result."),
  },
  {
    // Each task's own "confirm" setting in the Mac's config decides whether it waits for Face ID;
    // turning this action's confirm switch on in Platform Control makes every task wait.
    name: "desktop_run_task", label: "Run a task on the computer", risk: "write", confirmDefault: false, target: "agent",
    description: "Run one of the named tasks defined in the computer's agent config (see each agent's task list). Only those tasks exist; parameters must match the task's patterns. Read-style tasks (status, logs) can be run whenever they help answer; tasks that change something only when asked.",
    schema: { type: "object", properties: { ...agentProp, task: { type: "string" }, params: { type: "object", additionalProperties: { type: "string" } } }, required: ["task"], additionalProperties: false },
    describe: (p) => {
      const params = p["params"] && typeof p["params"] === "object" ? Object.entries(p["params"] as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(", ") : "";
      return `Run task “${str(p["task"])}”${params ? ` (${params})` : ""}${str(p["agent"]) ? ` on ${str(p["agent"])}` : ""}`;
    },
    spoken: (r) => { const x = r as { ok?: boolean; exitCode?: number }; return x?.ok ? "Task finished." : `Task failed${typeof x?.exitCode === "number" ? ` with exit code ${x.exitCode}` : ""}.`; },
  },
];

export const ACTION_MAP = new Map(ACTIONS.map((a) => [a.name, a]));

/** Which online agent a desktop_* action goes to, and is the request allowed by that agent's config? */
export async function resolveAgent(action: ActionDef, params: Record<string, unknown>): Promise<{ agentId: string; taskConfirm: boolean } | { error: string }> {
  const agents = await onlineAgents();
  if (!agents.length) return { error: "No desktop agent is online. The computer may be asleep or the agent stopped." };
  const wanted = str(params["agent"], 80).toLowerCase();
  const agent = wanted ? agents.find((a) => a.name.toLowerCase() === wanted) : agents.length === 1 ? agents[0] : undefined;
  if (!agent) return { error: wanted ? `No online agent named "${wanted}". Online: ${agents.map((a) => a.name).join(", ")}.` : `Several agents are online; say which: ${agents.map((a) => a.name).join(", ")}.` };
  if (action.name === "desktop_run_task") {
    const task = (agent.tasks as AgentTask[]).find((t) => t.name === str(params["task"], 80));
    if (!task) return { error: `"${agent.name}" has no task "${str(params["task"], 80)}". Its tasks: ${(agent.tasks as AgentTask[]).map((t) => t.name).join(", ") || "none"}.` };
    const given = params["params"] && typeof params["params"] === "object" ? (params["params"] as Record<string, unknown>) : {};
    for (const key of Object.keys(given)) if (!task.params[key]) return { error: `Task "${task.name}" has no parameter "${key}".` };
    for (const [key, spec] of Object.entries(task.params)) {
      const value = String(given[key] ?? "");
      if (!new RegExp(`^(?:${spec.pattern})$`).test(value)) return { error: `Parameter "${key}" must match ${spec.pattern}.` };
    }
    return { agentId: agent.id, taskConfirm: task.confirm };
  }
  if (action.name === "desktop_open_app" && !(agent.apps as string[]).includes(str(params["app"], 120))) {
    return { error: `"${str(params["app"], 120)}" is not in ${agent.name}'s allowed apps: ${(agent.apps as string[]).join(", ") || "none"}.` };
  }
  return { agentId: agent.id, taskConfirm: false };
}

/** The part of the system prompt that tells the interpreter what each online agent offers. */
export async function agentCatalog(): Promise<string> {
  const agents = await onlineAgents();
  if (!agents.length) return "No desktop agent is online right now.";
  return agents.map((a) => {
    const tasks = (a.tasks as AgentTask[]).map((t) => `  - ${t.name}: ${t.description}${Object.keys(t.params).length ? ` (params: ${Object.entries(t.params).map(([k, v]) => `${k} — ${v.description}`).join("; ")})` : ""}`).join("\n");
    return `Agent "${a.name}" (online). Folders: ${(a.folders as string[]).join(", ") || "none"}. Apps: ${(a.apps as string[]).join(", ") || "none"}.\n Tasks:\n${tasks || "  (none)"}`;
  }).join("\n");
}
