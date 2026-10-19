// Command Center switches. Every action is available; each organization
// switches off what it doesn't want and decides per action whether it waits
// for a Face ID approval. Stored in settings (key "command-center") per
// organization. FIAREP's own row ("default") is Platform Control's: its action
// switches apply to every client too (off there = off everywhere), and it holds
// the Claude model and each client's monthly spending cap.
import { and, eq } from "drizzle-orm";
import { db, organizations, settings } from "@workspace/db";

export type CommandSwitches = {
  enabled: boolean;
  actions: Record<string, boolean>;
  confirm: Record<string, boolean>;
  /** The Claude model. */
  model: string;
  /** Which model reads the commands: "claude" (default) or "gemini". Platform row only; applies to every client. */
  provider: "claude" | "gemini";
  /** The Gemini model, used when provider is "gemini". */
  geminiModel: string;
  /** Answer residents' messages about their complaints (app and website). On unless switched off. */
  residentChat: boolean;
  /** Platform row only: monthly Claude spending cap per client, in US dollars (absent = no cap). */
  caps?: Record<string, number>;
};

export const DEFAULT_MODEL = process.env["COMMAND_CENTER_MODEL"] || "claude-sonnet-5-5";
/** Google's "most intelligent Flash model; built for agents" (ai.google.dev/gemini-api/docs/models, Oct 18 2026). */
export const DEFAULT_GEMINI_MODEL = process.env["GEMINI_MODEL"] || "gemini-3.8-flash";
export const PLATFORM_TENANT = "default";
const KEY = "command-center";

const cache = new Map<string, { at: number; value: CommandSwitches }>();

export async function getSwitches(tenantId: string = PLATFORM_TENANT): Promise<CommandSwitches> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 10_000) return hit.value;
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, KEY))).limit(1);
  const v = (row?.value && typeof row.value === "object" ? row.value : {}) as Partial<CommandSwitches>;
  const caps = v.caps && typeof v.caps === "object" ? Object.fromEntries(Object.entries(v.caps).filter(([, n]) => typeof n === "number" && n >= 0)) : {};
  const value: CommandSwitches = {
    enabled: v.enabled !== false,
    actions: v.actions && typeof v.actions === "object" ? v.actions : {},
    confirm: v.confirm && typeof v.confirm === "object" ? v.confirm : {},
    model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULT_MODEL,
    provider: v.provider === "gemini" ? "gemini" : "claude",
    residentChat: v.residentChat !== false,
    geminiModel: typeof v.geminiModel === "string" && v.geminiModel.trim() ? v.geminiModel.trim() : DEFAULT_GEMINI_MODEL,
    ...(tenantId === PLATFORM_TENANT ? { caps } : {}),
  };
  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

export async function saveSwitches(next: CommandSwitches, tenantId: string = PLATFORM_TENANT): Promise<CommandSwitches> {
  const now = new Date();
  await db.insert(settings).values({ tenantId, key: KEY, value: next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: next, updatedAt: now } });
  cache.set(tenantId, { at: Date.now(), value: next });
  return next;
}

/** Platform -> Modules "command-center": OFF for every client until the platform owner switches it on for that client. */
export async function moduleOn(tenantId: string): Promise<boolean> {
  if (tenantId === PLATFORM_TENANT) return true;
  const [org] = await db.select({ features: organizations.features, status: organizations.status }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  if (!org || org.status !== "active") return false;
  const modules = org.features && typeof org.features === "object" ? (org.features as Record<string, unknown>)["modules"] : null;
  return !!(modules && typeof modules === "object" && (modules as Record<string, unknown>)["command-center"] === true);
}

/** What actually applies to one organization: Platform Control's switches on top of its own. */
export async function effectiveSwitches(tenantId: string): Promise<CommandSwitches & { moduleOn: boolean; platformEnabled: boolean }> {
  const platform = await getSwitches(PLATFORM_TENANT);
  if (tenantId === PLATFORM_TENANT) return { ...platform, moduleOn: true, platformEnabled: platform.enabled };
  const own = await getSwitches(tenantId);
  const on = await moduleOn(tenantId);
  const actions: Record<string, boolean> = { ...own.actions };
  for (const [k, v] of Object.entries(platform.actions)) if (v === false) actions[k] = false;
  return {
    enabled: platform.enabled && on && own.enabled,
    actions,
    confirm: { ...platform.confirm, ...own.confirm },
    model: platform.model,
    provider: platform.provider,
    residentChat: platform.residentChat && own.residentChat,
    geminiModel: platform.geminiModel,
    moduleOn: on,
    platformEnabled: platform.enabled,
  };
}

/** Switched on unless explicitly off. */
export const actionOn = (s: CommandSwitches, name: string) => s.actions[name] !== false;
/** Needs Face ID: the switch if set, otherwise the action's own default. */
export const confirmOn = (s: CommandSwitches, name: string, fallback: boolean) =>
  typeof s.confirm[name] === "boolean" ? s.confirm[name]! : fallback;
