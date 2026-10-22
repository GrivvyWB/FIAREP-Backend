// Platform Control → HR: job titles (with a description) added for every company's HR.
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";
import { STAFF_POSITIONS, setExtraPositions } from "./domain";

const KEY = "platform.hrPositions";
export type HrPosition = { title: string; description: string };

export async function getHrPositions(): Promise<HrPosition[]> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, "default"), eq(settings.key, KEY))).limit(1);
  const list = Array.isArray((row?.value as { list?: unknown } | undefined)?.list) ? (row!.value as { list: unknown[] }).list : [];
  return list.map((v) => (v && typeof v === "object" ? v as Record<string, unknown> : {}))
    .map((v) => ({ title: String(v["title"] ?? "").trim().slice(0, 80), description: String(v["description"] ?? "").trim().slice(0, 1000) }))
    .filter((v) => v.title);
}

export async function loadHrPositions(): Promise<HrPosition[]> {
  const list = await getHrPositions();
  setExtraPositions(list.map((p) => p.title));
  return list;
}

export async function saveHrPositions(input: unknown): Promise<HrPosition[] | { error: string }> {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const list: HrPosition[] = [];
  for (const v of raw) {
    const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
    const title = String(o["title"] ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    if ((STAFF_POSITIONS as readonly string[]).some((p) => p.toLowerCase() === key)) return { error: `${title} is already a job title.` };
    seen.add(key);
    list.push({ title, description: String(o["description"] ?? "").trim().slice(0, 1000) });
  }
  const now = new Date();
  await db.insert(settings).values({ tenantId: "default", key: KEY, value: { list }, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: { list }, updatedAt: now } });
  setExtraPositions(list.map((p) => p.title));
  return list;
}
