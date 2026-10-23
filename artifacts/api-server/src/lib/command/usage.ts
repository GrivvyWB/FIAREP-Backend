// What each organization's Command Center costs in Claude usage. FIAREP pays
// (one ANTHROPIC_API_KEY); every run records its tokens and, when the model's
// price is known, its cost. Platform Control shows each client's month and can
// cap it.
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { commandRuns } from "./tables";

<<<<<<< ours
/** US dollars per million tokens, base input / output (Gemini output includes thinking tokens).
 *  A model not listed here records tokens only (no dollar figure, no cap check).
 *  Neither engine uses prompt caching here, so input is billed at the base rate.
 *  Claude — platform.claude.com/docs/en/about-claude/pricing (checked Oct 18, 2026);
 *    Haiku 5.5 is the price for prompts up to 100,000 tokens (Command Center prompts are far smaller).
 *  Gemini — ai.google.dev/gemini-api/docs/pricing, paid tier, standard (checked Oct 18, 2026).
 *    Some Gemini prices change on a set date: `until` is the last day of the first price, `then` the price after. */
type Price = { input: number; output: number; source: string; until?: string; then?: { input: number; output: number } };
const CLAUDE = "platform.claude.com/docs/en/about-claude/pricing, Oct 18 2026";
const GEMINI = "ai.google.dev/gemini-api/docs/pricing, paid tier standard, Oct 18 2026";
export const MODEL_PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, source: CLAUDE },
  "claude-opus-5-5": { input: 4, output: 20, source: CLAUDE },
  "claude-sonnet-5-5": { input: 2, output: 10, source: CLAUDE },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, source: `${CLAUDE} (prompts up to 100,000 tokens)` },
  "gemini-4-argon": { input: 2, output: 10, until: "2026-11-30", then: { input: 4, output: 20 }, source: GEMINI },
  "gemini-3.8-flash": { input: 0.75, output: 3.75, until: "2026-12-31", then: { input: 1.5, output: 7.5 }, source: GEMINI },
  "gemini-3.6-flash": { input: 0.75, output: 3.75, until: "2026-12-31", then: { input: 1.5, output: 7.5 }, source: GEMINI },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, source: GEMINI },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, source: GEMINI },
  "gemini-3.1-pro-preview": { input: 2, output: 12, source: `${GEMINI} (prompts up to 200,000 tokens)` },
};

/** The price in effect on a day (Pacific time is Google's billing day; New York is close enough for a monthly view). */
export function priceOn(model: string, at = new Date()): { input: number; output: number } | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  const day = at.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return p.until && p.then && day > p.until ? p.then : { input: p.input, output: p.output };
}

/** Cost of one run in millionths of a dollar, or null when the model's price isn't known. */
export function costMicroUsd(model: string, usage: Record<string, number>, at = new Date()): number | null {
  const price = priceOn(model, at);
  if (!price) return null;
  return Math.round((usage["input_tokens"] ?? 0) * price.input + (usage["output_tokens"] ?? 0) * price.output);
=======
/** US dollars per million tokens, base input / output.
 *  Source: platform.claude.com/docs/en/about-claude/pricing (checked Oct 18, 2026).
 *  Haiku 5.5 is the price for prompts up to 100,000 tokens (Command Center prompts are far smaller).
 *  A model not listed here records tokens only (no dollar figure, no cap check).
 *  The Command Center doesn't use prompt caching, so input is billed at the base rate. */
const SOURCE = "platform.claude.com/docs/en/about-claude/pricing, Oct 18 2026";
export const MODEL_PRICES: Record<string, { input: number; output: number; source: string }> = {
  "claude-fable-5-1": { input: 10, output: 50, source: SOURCE },
  "claude-opus-5-5": { input: 4, output: 20, source: SOURCE },
  "claude-sonnet-5-5": { input: 2, output: 10, source: SOURCE },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, source: `${SOURCE} (prompts up to 100,000 tokens)` },
};

/** Cost of one run in millionths of a dollar, or null when the model's price isn't known. */
export function costMicroUsd(model: string, usage: Record<string, number>): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const input = usage["input_tokens"] ?? 0;
  return Math.round(input * price.input + (usage["output_tokens"] ?? 0) * price.output);
>>>>>>> theirs
}

/** First moment of this calendar month in New York. */
export function monthStart(now = new Date()): Date {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = now.getTime() - ny.getTime();
  return new Date(new Date(ny.getFullYear(), ny.getMonth(), 1).getTime() + offset);
}

export type MonthUsage = { tenantId: string; runs: number; inputTokens: number; outputTokens: number; costUsd: number; unpricedRuns: number };

/** This month's usage, per organization (or one organization). */
export async function monthUsage(tenantId?: string): Promise<MonthUsage[]> {
  const rows = await db.select({
    tenantId: commandRuns.tenantId,
    runs: sql<number>`count(*)::int`,
    inputTokens: sql<number>`coalesce(sum((${commandRuns.usage}->>'input_tokens')::bigint), 0)::bigint`,
    outputTokens: sql<number>`coalesce(sum((${commandRuns.usage}->>'output_tokens')::bigint), 0)::bigint`,
    costMicro: sql<number>`coalesce(sum((${commandRuns.usage}->>'cost_usd_micro')::bigint), 0)::bigint`,
    unpriced: sql<number>`count(*) filter (where ${commandRuns.usage}->>'cost_usd_micro' is null)::int`,
  }).from(commandRuns)
    .where(and(gte(commandRuns.createdAt, monthStart()), tenantId ? eq(commandRuns.tenantId, tenantId) : sql`true`))
    .groupBy(commandRuns.tenantId);
  return rows.map((r) => ({ tenantId: r.tenantId, runs: Number(r.runs), inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens), costUsd: Number(r.costMicro) / 1e6, unpricedRuns: Number(r.unpriced) }));
}
