// Small-client setup: every Platform Control switch saved from one client, applied
// to a new client in one press. Kept in FIAREP's settings.
import { and, eq } from "drizzle-orm";
import { db, organizations, settings } from "@workspace/db";

const KEY = "platform.smallClientSetup";
export type SetupTemplate = { modules: Record<string, boolean>; deletionEnabled: boolean; fromId: string; fromName: string; savedAt: string; savedBy: string };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const switches = (v: unknown): Record<string, boolean> => Object.fromEntries(Object.entries(obj(v)).filter((e): e is [string, boolean] => typeof e[1] === "boolean"));

export async function getSetupTemplate(): Promise<SetupTemplate | null> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, "default"), eq(settings.key, KEY))).limit(1);
  const v = obj(row?.value);
  if (!v["savedAt"]) return null;
  return { modules: switches(v["modules"]), deletionEnabled: v["deletionEnabled"] === true, fromId: String(v["fromId"] || ""), fromName: String(v["fromName"] || ""), savedAt: String(v["savedAt"]), savedBy: String(v["savedBy"] || "") };
}

/** Save every switch on this client's Platform Control page as the small-client setup. */
export async function saveSetupTemplate(organizationId: string, by: string): Promise<SetupTemplate | { error: string; status: number }> {
  if (organizationId === "default") return { error: "Save it from a client, not FIAREP.", status: 400 };
  const [org] = await db.select({ id: organizations.id, name: organizations.name, features: organizations.features }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return { error: "Organization not found", status: 404 };
  const f = obj(org.features);
  const t: SetupTemplate = { modules: switches(f["modules"]), deletionEnabled: f["deletionEnabled"] === true, fromId: org.id, fromName: org.name, savedAt: new Date().toISOString(), savedBy: by };
  const now = new Date();
  await db.insert(settings).values({ tenantId: "default", key: KEY, value: t, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: t, updatedAt: now } });
  return t;
}

/** Set every switch on this client to the small-client setup. Its buildings, staff, codes and email address stay as they are. */
export async function applySetupTemplate(organizationId: string): Promise<{ before: unknown; after: unknown; switches: number } | { error: string; status: number }> {
  if (organizationId === "default") return { error: "The small-client setup is for clients, not FIAREP.", status: 400 };
  const t = await getSetupTemplate();
  if (!t) return { error: "No small-client setup saved yet. Open the client you set up the way you like and press Save as small-client setup.", status: 400 };
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return { error: "Organization not found", status: 404 };
  const f = obj(org.features);
  // Exactly the saved switches: a switch the saved client never set reads the same default here too.
  const keepOther = Object.fromEntries(Object.entries(obj(f["modules"])).filter(([, v]) => typeof v !== "boolean"));
  const next = { ...f, modules: { ...keepOther, ...t.modules }, deletionEnabled: t.deletionEnabled };
  await db.update(organizations).set({ features: next, updatedAt: new Date() }).where(eq(organizations.id, organizationId));
  return { before: f, after: next, switches: Object.keys(t.modules).length };
}
