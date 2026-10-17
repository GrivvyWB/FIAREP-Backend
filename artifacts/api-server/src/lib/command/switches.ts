// Platform Control → Command Center switches. Every action is available; Tim
// switches off what he doesn't want, and decides per action whether it waits
// for a Face ID approval. Stored in settings (tenant "default", key "command-center").
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";

export type CommandSwitches = {
  enabled: boolean;
  actions: Record<string, boolean>;
  confirm: Record<string, boolean>;
  model: string;
};

export const DEFAULT_MODEL = process.env["COMMAND_CENTER_MODEL"] || "claude-sonnet-5-5";
const KEY = "command-center";
const TENANT = "default";

let cache: { at: number; value: CommandSwitches } | null = null;

export async function getSwitches(): Promise<CommandSwitches> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, TENANT), eq(settings.key, KEY))).limit(1);
  const v = (row?.value && typeof row.value === "object" ? row.value : {}) as Partial<CommandSwitches>;
  const value: CommandSwitches = {
    enabled: v.enabled !== false,
    actions: v.actions && typeof v.actions === "object" ? v.actions : {},
    confirm: v.confirm && typeof v.confirm === "object" ? v.confirm : {},
    model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULT_MODEL,
  };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSwitches(next: CommandSwitches): Promise<CommandSwitches> {
  const now = new Date();
  await db.insert(settings).values({ tenantId: TENANT, key: KEY, value: next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: next, updatedAt: now } });
  cache = { at: Date.now(), value: next };
  return next;
}

/** Switched on unless explicitly off. */
export const actionOn = (s: CommandSwitches, name: string) => s.actions[name] !== false;
/** Needs Face ID: the switch if set, otherwise the action's own default. */
export const confirmOn = (s: CommandSwitches, name: string, fallback: boolean) =>
  typeof s.confirm[name] === "boolean" ? s.confirm[name]! : fallback;
