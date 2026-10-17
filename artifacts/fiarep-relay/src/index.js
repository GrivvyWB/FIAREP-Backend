// FIAREP backup relay (Cloudflare Worker + KV).
// Keeps working when fiarep.com / Replit is down, so the Mac can tell your
// phone "FIAREP is down" and your phone can approve a republish with Face ID.
//
//   Server  POST /server/devices                 FIAREP API pushes the approved phones here (SERVER_TOKEN)
//   Mac     GET  /agent/poll                     settings + approved outages        (AGENT_TOKEN)
//           POST /agent/incidents                report an outage → push to phone
//           POST /agent/incidents/:id/start|result
//   Phone   GET  /phone/state                    outages + Mac last seen + auto-fix  (device-key signed)
//           POST /phone/push                     register this phone's push token
//           POST /phone/incidents/:id/approve    Face ID signature (verified here AND on the Mac)
//           POST /phone/incidents/:id/deny
//           POST /phone/settings                 auto-fix on/off (Face ID signed)
//
// KV free tier is 1,000 writes/day: nothing here writes on a routine poll
// except the Mac's "last seen" stamp, at most once every 10 minutes.

const SKEW_MS = 120_000;
const INCIDENT_TTL_MS = 30 * 60_000;
const SEEN_EVERY_MS = 10 * 60_000;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = new TextEncoder();

// ── signatures (same strings as the API, phone and Mac) ────────────────────
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}
async function sha256hex(data) {
  const buf = await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function confirmMessage(a) {
  return `FIAREP-CMD-CONFIRM\n${a.id}\n${a.action}\n${a.target}\n${await sha256hex(canonicalJson(a.params))}\n${a.nonce}\n${a.expiresAt}`;
}
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function verifyEd25519(pubB64, message, sigB64) {
  try {
    const raw = b64(pubB64); const sig = b64(sigB64 || "");
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, enc.encode(message));
  } catch { return false; }
}
const sameToken = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

// ── storage ────────────────────────────────────────────────────────────────
const get = async (env, key, fallback) => (await env.RELAY.get(key, "json")) ?? fallback;
const put = (env, key, value) => env.RELAY.put(key, JSON.stringify(value));

function view(i) {
  const expired = i.status === "open" && Date.now() > i.expiresAt;
  return { ...i, status: expired ? "expired" : i.status };
}
async function incidents(env) { return (await get(env, "incidents", [])).map(view); }
async function saveIncident(env, inc) {
  const list = (await get(env, "incidents", [])).filter((x) => x.id !== inc.id);
  list.unshift(inc);
  await put(env, "incidents", list.slice(0, 20));
}

async function push(env, title, body) {
  const tokens = Object.values(await get(env, "push", {}));
  if (!tokens.length) return;
  await fetch(env.PUSH_URL || "https://exp.host/--/api/v2/push/send", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: "default", priority: "high", data: { url: "/command-center" } }))),
  }).catch(() => undefined);
}

const seen = new Map(); // replay guard (per isolate, within the clock window)
async function phoneAuth(req, env, bodyText) {
  const deviceId = req.headers.get("x-command-device") || "";
  const time = req.headers.get("x-command-time") || "";
  const sig = req.headers.get("x-command-sig") || "";
  if (!/^\d{10,16}$/.test(time) || Math.abs(Date.now() - Number(time)) > SKEW_MS) return { error: "Stale request — check the phone's clock.", status: 401 };
  const device = (await get(env, "devices", [])).find((d) => d.id === deviceId && d.status === "active");
  if (!device) return { error: "This phone is not approved for the backup relay.", status: 403 };
  const url = new URL(req.url);
  const msg = `FIAREP-CMD-REQ\n${req.method}\n${url.pathname}${url.search}\n${time}\n${await sha256hex(bodyText)}`;
  if (!(await verifyEd25519(device.deviceKey, msg, sig))) return { error: "Device signature did not verify.", status: 401 };
  if (seen.has(sig)) return { error: "Replayed request.", status: 401 };
  seen.set(sig, Date.now());
  if (seen.size > 2000) for (const [k, t] of seen) if (Date.now() - t > SKEW_MS * 2) seen.delete(k);
  return { device };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const bodyText = req.method === "GET" ? "" : await req.text();
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { return json({ error: "Bad JSON" }, 400); }
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

    if (p === "/" || p === "/health") return json({ ok: true, service: "fiarep-relay" });

    // ── FIAREP API → relay ──
    if (p === "/server/devices" && req.method === "POST") {
      if (!sameToken(bearer, env.SERVER_TOKEN)) return json({ error: "Unauthorized" }, 401);
      const devices = (Array.isArray(body.devices) ? body.devices : []).slice(0, 20).map((d) => ({
        id: String(d.id || ""), name: String(d.name || "").slice(0, 80), deviceKey: String(d.deviceKey || ""), confirmKey: String(d.confirmKey || ""), status: d.status === "active" ? "active" : "revoked",
      })).filter((d) => d.id && d.deviceKey && d.confirmKey);
      await put(env, "devices", devices);
      // Drop push tokens of phones that are no longer approved.
      const tokens = await get(env, "push", {});
      const active = new Set(devices.filter((d) => d.status === "active").map((d) => d.id));
      const kept = Object.fromEntries(Object.entries(tokens).filter(([id]) => active.has(id)));
      if (Object.keys(kept).length !== Object.keys(tokens).length) await put(env, "push", kept);
      return json({ ok: true, devices: devices.length });
    }

    // ── Mac → relay ──
    if (p.startsWith("/agent/")) {
      if (!sameToken(bearer, env.AGENT_TOKEN)) return json({ error: "Unauthorized" }, 401);
      if (p === "/agent/poll" && req.method === "GET") {
        const last = await get(env, "agentSeen", 0);
        if (Date.now() - last > SEEN_EVERY_MS) await put(env, "agentSeen", Date.now());
        const list = await incidents(env);
        return json({ settings: await get(env, "settings", { autoFix: false }), approved: list.filter((i) => i.status === "approved"), open: list.filter((i) => i.status === "open").map((i) => i.id) });
      }
      if (p === "/agent/incidents" && req.method === "POST") {
        const list = await incidents(env);
        const already = list.find((i) => ["open", "approved", "running"].includes(i.status));
        if (already) return json(already);
        const now = Date.now();
        const inc = {
          id: crypto.randomUUID(), kind: "site_down", action: "relay_republish", target: "relay",
          detail: String(body.detail || "").slice(0, 300), createdAt: now, status: "open",
          nonce: [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""),
          expiresAt: now + INCIDENT_TTL_MS, autoFixed: body.autoFix === true,
        };
        if (inc.autoFixed) inc.status = "running";
        await saveIncident(env, inc);
        await push(env, inc.autoFixed ? "FIAREP is down — republishing now" : "FIAREP is down",
          inc.autoFixed ? "Auto-fix is on; the Mac is republishing on Replit." : "Open Command Center to approve a republish with Face ID.");
        return json(inc, 201);
      }
      const m = p.match(/^\/agent\/incidents\/([\w-]+)\/(start|result)$/);
      if (m && req.method === "POST") {
        const inc = (await get(env, "incidents", [])).find((i) => i.id === m[1]);
        if (!inc) return json({ error: "Unknown incident" }, 404);
        if (m[2] === "start") inc.status = "running";
        else {
          inc.status = body.ok ? "done" : "failed";
          inc.result = { ok: !!body.ok, detail: String(body.detail || "").slice(0, 500), at: Date.now() };
          await push(env, body.ok ? "FIAREP is back up" : "Republish did not bring FIAREP back", inc.result.detail || "");
        }
        await saveIncident(env, inc);
        return json(view(inc));
      }
      return json({ error: "Not found" }, 404);
    }

    // ── Phone → relay ──
    if (p.startsWith("/phone/")) {
      const auth = await phoneAuth(req, env, bodyText);
      if (auth.error) return json({ error: auth.error }, auth.status);
      if (p === "/phone/state" && req.method === "GET") {
        return json({ agentSeen: await get(env, "agentSeen", 0), settings: await get(env, "settings", { autoFix: false }), incidents: await incidents(env) });
      }
      if (p === "/phone/push" && req.method === "POST") {
        const token = String(body.token || "");
        if (!/^Expo(nent)?PushToken\[[^\]]{8,120}\]$/.test(token)) return json({ error: "Not an Expo push token" }, 400);
        const tokens = await get(env, "push", {});
        if (tokens[auth.device.id] !== token) { tokens[auth.device.id] = token; await put(env, "push", tokens); }
        return json({ ok: true });
      }
      if (p === "/phone/settings" && req.method === "POST") {
        const autoFix = body.autoFix === true;
        const time = String(body.time || "");
        const msg = `FIAREP-RELAY-AUTOFIX\n${autoFix}\n${time}`;
        if (Math.abs(Date.now() - Number(time)) > SKEW_MS || !(await verifyEd25519(auth.device.confirmKey, msg, body.signature))) return json({ error: "Face ID signature did not verify." }, 401);
        const settings = { autoFix, time, signature: body.signature, deviceId: auth.device.id };
        await put(env, "settings", settings);
        return json(settings);
      }
      const m = p.match(/^\/phone\/incidents\/([\w-]+)\/(approve|deny)$/);
      if (m && req.method === "POST") {
        const list = await get(env, "incidents", []);
        const inc = list.find((i) => i.id === m[1]);
        if (!inc) return json({ error: "Unknown incident" }, 404);
        if (view(inc).status !== "open") return json({ error: `Already ${view(inc).status}.` }, 409);
        if (m[2] === "deny") { inc.status = "denied"; await saveIncident(env, inc); return json(view(inc)); }
        const msg = await confirmMessage({ id: inc.id, action: inc.action, target: inc.target, params: { incident: inc.id, kind: inc.kind }, nonce: inc.nonce, expiresAt: inc.expiresAt });
        if (!(await verifyEd25519(auth.device.confirmKey, msg, body.signature))) return json({ error: "Face ID signature did not verify." }, 401);
        inc.status = "approved"; inc.signature = body.signature; inc.approvedBy = auth.device.name || auth.device.id; inc.approvedAt = Date.now();
        await saveIncident(env, inc);
        return json(view(inc));
      }
      return json({ error: "Not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  },
};
