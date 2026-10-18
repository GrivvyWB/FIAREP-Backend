// Backup relay (Cloudflare Worker): when fiarep.com is down, the phone and the
// Mac still reach each other through it. The API's only job is to keep the
// relay's list of approved phones current. Env: RELAY_URL, RELAY_SERVER_TOKEN.
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { commandDevices } from "./tables";
import { logger } from "../logger";

export const relayUrl = () => (process.env["RELAY_URL"] || "").replace(/\/+$/, "") || null;

export async function syncRelayDevices(): Promise<{ ok: boolean; error?: string }> {
  const url = relayUrl();
  const token = process.env["RELAY_SERVER_TOKEN"];
  if (!url || !token) return { ok: false, error: "RELAY_URL / RELAY_SERVER_TOKEN not set" };
  try {
    // Only FIAREP's own phones: the relay republishes FIAREP's servers; a client's phone never gets a say.
    const devices = await db.select().from(commandDevices).where(eq(commandDevices.tenantId, "default"));
    const res = await fetch(`${url}/server/devices`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ devices: devices.filter((d) => d.status !== "pending").map((d) => ({ id: d.id, name: d.name, deviceKey: d.deviceKey, confirmKey: d.confirmKey, status: d.status })) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`relay answered HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "relay sync failed";
    logger.warn({ err }, "Backup relay device sync failed");
    return { ok: false, error };
  }
}
