// In-process signals between the API and desktop agents: wake an agent's
// long-poll when a job is queued, wake a waiting command when a job finishes.
import { EventEmitter } from "node:events";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { commandActions, commandAgents } from "./tables";

const bus = new EventEmitter();
bus.setMaxListeners(0);

export const ONLINE_WINDOW_MS = 90_000;

export function signalAgent(agentId: string): void { bus.emit(`agent:${agentId}`); }
export function signalResult(actionId: string): void { bus.emit(`result:${actionId}`); }

/** Resolves true when the event fires, false on timeout. */
export function waitForEvent(event: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (fired: boolean) => { clearTimeout(timer); bus.off(event, onEvent); resolve(fired); };
    const onEvent = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    bus.on(event, onEvent);
  });
}

/** Wait (up to ms) for an agent job to finish; returns the row as it stands. */
export async function waitForActionResult(actionId: string, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const [row] = await db.select().from(commandActions).where(eq(commandActions.id, actionId)).limit(1);
    if (!row || ["done", "failed", "denied", "expired"].includes(row.status)) return row ?? null;
    await waitForEvent(`result:${actionId}`, Math.min(5_000, deadline - Date.now()));
  }
  const [row] = await db.select().from(commandActions).where(eq(commandActions.id, actionId)).limit(1);
  return row ?? null;
}

export async function onlineAgents() {
  return db.select().from(commandAgents).where(and(
    eq(commandAgents.status, "active"),
    isNull(commandAgents.revokedAt),
    gt(commandAgents.lastSeenAt, new Date(Date.now() - ONLINE_WINDOW_MS)),
  ));
}
