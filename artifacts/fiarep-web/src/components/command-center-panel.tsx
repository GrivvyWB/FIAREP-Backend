import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type ActionMeta = { name: string; label: string; risk: "read" | "write"; confirmDefault: boolean; target: "server" | "agent" };
type Switches = { enabled: boolean; actions: Record<string, boolean>; confirm: Record<string, boolean>; model: string; provider: "claude" | "gemini"; geminiModel: string; residentChat: boolean; autoWorkOrders: boolean; caps?: Record<string, number> };
type ChatMsg = { id: string; from: "resident" | "office" | "staff"; text: string; at: string; by?: string };
type Conversation = { id: string; complaintNo: string; address: string; unit: string; description: string; human: boolean; handoff: { reason?: string; urgent?: boolean } | null; appointment: string | null; lastAt: string; waiting: boolean; messages: ChatMsg[] };
type Device = { id: string; name: string; staffName: string; status: "pending" | "active" | "revoked"; confirmKey: string; createdAt: string; approvedAt: string | null; approvedBy: string | null; lastUsedAt: string | null };
type AgentTask = { name: string; description: string; confirm: boolean; params: Record<string, { description: string; pattern: string }> };
type Agent = { id: string; name: string; status: string; online: boolean; lastSeenAt: string | null; info: Record<string, unknown>; tasks: AgentTask[]; folders: string[]; apps: string[]; createdAt: string };
type Install = { windows: string; mac: string; linux: string };
type Usage = { runs: number; inputTokens: number; outputTokens: number; costUsd: number; unpricedRuns: number };
type Client = { id: string; name: string; status: string; on: boolean; cap: number | null; usage: Usage | null; phones: { active: number; pending: number }; computers: { total: number; online: number } };
type Overview = {
  switches: Switches; schedule?: Schedule; mapsKey?: { set: boolean; source?: string | null; last4?: string | null }; actions: ActionMeta[]; devices: Device[]; agents: Agent[]; install: Install; usage: Usage | null; claudeKeyConfigured: boolean; audit: { ok: boolean; rows: number; brokenAt?: number | null };
  // Platform Control only
  defaultModel?: string; defaultGeminiModel?: string; geminiKeyConfigured?: boolean; geminiKey?: { set: boolean; source: "replit-secrets" | "terminal" | null; last4: string | null }; prices?: Record<string, { input: number; output: number; source: string }>; relay?: { url: string | null; serverTokenSet: boolean }; voiceKeyConfigured?: boolean; clients?: Client[];
  // A client's own only
  platformEnabled?: boolean; platformOff?: string[]; cap?: number | null; capProblem?: string | null;
};
type Schedule = { dayStart: string; dayEnd: string; workDays: number[]; defaultJobMinutes: number; minutesPerApartment: number; buildingDayApartments: number };
type AuditRow = { seq: number; at: string; actor: string; event: string; detail: Record<string, unknown> };
type Report = { id: string; title: string; createdBy: string; createdAt: string };
type WorkOrder = { id: string; status: string; urgency: string; address: string; borough: string; kind: string; title: string; createdAt: string; decidedBy: string | null; assignedName?: string | null };
type Os = keyof Install;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const money = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
const api = <T,>(path: string, init: Record<string, unknown> = {}) => customFetch<T>(`/api${path}`, { responseType: "json", ...init } as never);
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const OS_LABEL: Record<Os, string> = { windows: "Windows PC", mac: "Mac", linux: "Linux" };
const OS_HOW: Record<Os, string> = {
  windows: "On the PC: Start menu → type PowerShell → open Windows PowerShell → paste the line → Enter. No administrator rights needed. Node.js is installed for you if it's missing (winget).",
  mac: "On the Mac: open Terminal (Cmd+Space, type Terminal) → paste the line → Enter.",
  linux: "On the Linux computer: open a terminal → paste the line → Enter. Needs Node.js 20+ (nodejs.org).",
};
const guessOs = (): Os => (/Windows/i.test(navigator.userAgent) ? "windows" : /Mac/i.test(navigator.userAgent) ? "mac" : "linux");

/** A length of time as hours + minutes (1 hr 30 min, not 90 min). Stored in minutes. */
function DurationField({ label, value, onChange }: { label: string; value: number; onChange: (minutes: number) => void }) {
  const h = Math.floor(value / 60), m = value % 60;
  const set = (hh: number, mm: number) => onChange(Math.min(720, Math.max(15, hh * 60 + mm)));
  return (
    <div className="flex flex-col text-xs text-slate-600">{label}
      <div className="mt-1 flex items-center gap-1">
        <select value={h} onChange={(e) => set(Number(e.target.value), m)} className="rounded-md border border-slate-300 px-1 py-1 text-sm">{Array.from({ length: 13 }, (_, i) => <option key={i} value={i}>{i} hr{i === 1 ? "" : "s"}</option>)}</select>
        <select value={m} onChange={(e) => set(h, Number(e.target.value))} className="rounded-md border border-slate-300 px-1 py-1 text-sm">{[0, 15, 30, 45].map((x) => <option key={x} value={x}>{x} min</option>)}</select>
      </div>
    </div>
  );
}

/** The install line per operating system, with a copy button. */
function InstallLines({ lines, onCopy }: { lines: Install; onCopy: (text: string, what: string) => void }) {
  const [os, setOs] = useState<Os>(guessOs);
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(OS_LABEL) as Os[]).map((k) => (
          <button key={k} type="button" onClick={() => setOs(k)} className={`rounded-md px-3 py-1 text-xs font-semibold ${os === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{OS_LABEL[k]}</button>
        ))}
      </div>
      <button type="button" onClick={() => onCopy(lines[os], "Install line")} className="mt-2 block w-full break-all rounded bg-slate-950 p-2 text-left font-mono text-[11px] leading-relaxed text-emerald-200 hover:bg-slate-900">{lines[os]}</button>
      <p className="mt-1 text-xs text-slate-600">{OS_HOW[os]} Click the line to copy it.</p>
    </div>
  );
}

/** The Command Center control panel. "platform": Platform Control → Command
 *  Center (FIAREP's own, plus every client's on/off, usage and cap). "org": a
 *  client's own page in its menu (its phones, computers, switches, audit). */
export function CommandCenterPanel({ scope }: { scope: "platform" | "org" }) {
  const { toast } = useToast();
  const base = scope === "platform" ? "/v1/platform/command" : "/v1/org/command";
  const platform = scope === "platform";
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [agentName, setAgentName] = useState("");
  const [newAgent, setNewAgent] = useState<{ name: string; token: string; install: Install } | null>(null);
  const [model, setModel] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [sched, setSched] = useState<Schedule | null>(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const fail = (title: string) => (err: any) => toast({ variant: "destructive", title, description: err?.data?.error || err?.message });

  async function load() {
    try {
      const [o, a, w, c] = await Promise.all([
        api<Overview>(base),
        api<{ rows: AuditRow[] }>(`${base}/audit?limit=200`),
        api<WorkOrder[]>(`${base}/work-orders`),
        api<Conversation[]>(`${base}/resident-chats`).catch(() => [] as Conversation[]),
      ]);
      setChats(c);
      setReports(await api<Report[]>(`${base}/reports`).catch(() => [] as Report[]));
      setData(o); setAudit(a.rows); setOrders(w); setModel((m) => m || o.switches.model); setSched((x) => x ?? o.schedule ?? null); setGeminiModel((m) => m || o.switches.geminiModel || ""); setLoadError("");
    } catch (err: any) { setLoadError(err?.data?.error || err?.message || "Could not load the Command Center"); }
  }
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Open a report in a new tab, laid out to print. */
  async function openReport(r: Report) {
    const w = window.open("", "_blank");
    try {
      const full = await api<Report & { body: string }>(`${base}/reports/${encodeURIComponent(r.id)}`);
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const lines = full.body.split("\n").map((l) => l.startsWith("# ") ? `<h2>${esc(l.slice(2))}</h2>` : l.startsWith("- ") ? `<li>${esc(l.slice(2))}</li>` : l.trim() ? `<p>${esc(l)}</p>` : "").join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(full.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#0f172a;line-height:1.5}h1{font-size:24px;margin:0}h2{font-size:17px;margin:22px 0 6px}.m{color:#64748b;font-size:13px;margin:4px 0 20px}li{margin-left:18px}@media print{button{display:none}}</style></head><body><button onclick="print()">Print</button><h1>${esc(full.title)}</h1><p class="m">${esc(full.createdBy)} · ${new Date(full.createdAt).toLocaleString()}</p>${lines}</body></html>`;
      if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    } catch (err) { w?.close(); fail("Could not open the report")(err); }
  }

  async function saveSwitches(patch: Partial<Switches>) {
    if (!data) return;
    const next = { ...data.switches, ...patch };
    setData({ ...data, switches: next });
    try { await api(`${base}/switches`, json("PUT", next)); }
    catch (err) { fail("Could not save")(err); await load(); }
  }
  const platformOff = (name: string) => !!data?.platformOff?.includes(name);
  const on = (name: string) => !platformOff(name) && data?.switches.actions[name] !== false;
  const needsFaceId = (a: ActionMeta) => (typeof data?.switches.confirm[a.name] === "boolean" ? data.switches.confirm[a.name]! : a.confirmDefault);

  async function device(d: Device, decision: "approve" | "revoke") {
    if (decision === "revoke" && !window.confirm(`Revoke ${d.name}? It can't send commands until it's set up and approved again.`)) return;
    try { await api(`${base}/devices/${encodeURIComponent(d.id)}/${decision}`, { method: "POST" }); await load(); } catch (err) { fail("Could not update the phone")(err); }
  }
  async function addAgent() {
    try { const r = await api<{ name: string; token: string; install: Install }>(`${base}/agents`, json("POST", { name: agentName.trim() })); setNewAgent(r); setAgentName(""); await load(); }
    catch (err) { fail("Could not add the computer")(err); }
  }
  async function revokeAgent(a: Agent) {
    if (!window.confirm(`Revoke ${a.name}? Its token stops working immediately.`)) return;
    try { await api(`${base}/agents/${encodeURIComponent(a.id)}/revoke`, { method: "POST" }); await load(); } catch (err) { fail("Could not revoke")(err); }
  }
  async function removeAgent(a: Agent) {
    if (!window.confirm(`Remove ${a.name} from the list?`)) return;
    try { await api(`${base}/agents/${encodeURIComponent(a.id)}`, { method: "DELETE" }); await load(); } catch (err) { fail("Could not remove")(err); }
  }
  async function syncRelay() {
    try { const r = await api<{ ok: boolean; error?: string }>("/v1/platform/command/relay/sync", { method: "POST" }); toast(r.ok ? { title: "Phones sent to the backup relay" } : { variant: "destructive", title: "Relay sync failed", description: r.error }); }
    catch (err) { fail("Relay sync failed")(err); }
  }
  async function saveClient(c: Client, patch: { on?: boolean; cap?: number | null }) {
    try { await api(`/v1/platform/command/clients/${encodeURIComponent(c.id)}`, json("PUT", patch)); await load(); toast({ title: `${c.name} saved` }); }
    catch (err) { fail("Could not save the client")(err); }
  }
  async function chatAction(c: Conversation, body: { text?: string; takeOver?: boolean; giveBack?: boolean }) {
    try { await api(`${base}/resident-chats/${encodeURIComponent(c.id)}`, json("POST", body)); if (body.text) setReply(""); await load(); }
    catch (err) { fail("Could not update the conversation")(err); }
  }
  async function saveSchedule() {
    if (!sched) return;
    try { const r = await api<Schedule>(`${base}/schedule`, json("PUT", sched)); setSched(r); toast({ title: "Scheduling saved" }); await load(); }
    catch (err) { fail("Could not save scheduling")(err); }
  }
  const copy = (text: string, what: string) => { void navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); };

  if (!data) return <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">{loadError || "Loading…"}</p>;
  const pendingPhones = data.devices.filter((d) => d.status === "pending");
  const otherPhones = data.devices.filter((d) => d.status !== "pending");
  const drafts = orders.filter((o) => o.status === "draft");
  const offByFiarep = !platform && data.platformEnabled === false;
  const gemini = data.switches.provider === "gemini";
  const activeModel = gemini ? data.switches.geminiModel : data.switches.model;
  const priceText = (m: string) => { const p = data.prices?.[m] as ({ input: number; output: number; source: string; until?: string; then?: { input: number; output: number } } | undefined); return p ? `$${p.input} in / $${p.output} out per million tokens${p.until && p.then ? ` through ${p.until}, then $${p.then.input} / $${p.then.output}` : ""} — ${p.source}` : "no price on file for this model: tokens are counted, no dollar figure"; };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-950">Command Center</h1>
          <p className="text-sm text-slate-500">{platform
            ? "Talk to FIAREP and your computer from the phone. Reads answer right away; anything that changes something can wait for Face ID on the phone. Every step is written to a tamper-evident audit trail. Each client has its own Command Center (Clients, below)."
            : "Talk to your buildings, work orders and computers from your phone. Questions answer right away; anything that changes something waits for your Face ID on the phone. Everything is limited to your company, and every step is written to a tamper-evident audit trail."}</p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-sm font-semibold text-slate-900">Command Center {data.switches.enabled && !offByFiarep ? "ON" : "OFF"}</span>
          <Switch checked={data.switches.enabled} disabled={offByFiarep} onCheckedChange={(v) => void saveSwitches({ enabled: v })} />
        </label>
      </div>

      {offByFiarep && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">FIAREP has the Command Center switched off right now.</div>}
      {data.capProblem && <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{data.capProblem}</div>}
      {((platform ? (gemini ? !data.geminiKeyConfigured : !data.claudeKeyConfigured) : !data.claudeKeyConfigured) || (platform && !data.voiceKeyConfigured)) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {platform && !gemini && !data.claudeKeyConfigured && <p><b>ANTHROPIC_API_KEY</b> is not set on the API server — commands can't be understood until it is (Replit → Secrets).</p>}
          {platform && gemini && !data.geminiKeyConfigured && <p>No Gemini API key yet — with Gemini on, commands can't be understood until one is set (run <code>set-gemini-key.sh</code> in Terminal on the Mac).</p>}
          {!platform && !data.claudeKeyConfigured && <p>Commands are not available yet — FIAREP is finishing the setup.</p>}
          {platform && !data.voiceKeyConfigured && <p><b>OPENAI_API_KEY</b> is not set — voice in/out won't work (typing still does).</p>}
        </div>
      )}

      {!platform && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">This month</h2>
          <p className="mt-1 text-sm text-slate-700">{data.usage ? `${data.usage.runs} command${data.usage.runs === 1 ? "" : "s"}` : "No commands yet"}{data.cap !== null && data.cap !== undefined ? ` · monthly limit ${money(data.cap)}${data.usage ? `, ${money(data.usage.costUsd)} used` : ""}` : ""}</p>
        </section>
      )}

      {platform && data.clients && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Clients</h2>
          <p className="text-xs text-slate-500">Every client starts with the Command Center <b>off</b> — it isn't in their menu or app and they don't see it. Switch it on here (or Platform → Modules) when a client asks for it. Once on, the client has its own Command Center: its administrators set up their phones in the app and approve them, add their computers (Windows, Mac or Linux) and switch actions on fiarep.com → Command Center. It only ever sees that client's buildings, alerts, work orders, complaints and computers — never the FIAREP server. Usage runs on FIAREP's {gemini ? "Gemini" : "Claude"} key; this month's cost per client is below ({activeModel}: {priceText(activeModel)}). A cap stops that client's commands for the rest of the month once reached.</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Client</th><th className="py-1 pr-3">On</th><th className="py-1 pr-3">This month</th><th className="py-1 pr-3">Monthly cap</th><th className="py-1 pr-3">Phones</th><th className="py-1">Computers</th></tr></thead>
            <tbody>{data.clients.map((c) => {
              const capText = caps[c.id] ?? (c.cap === null ? "" : String(c.cap));
              return (
                <tr key={c.id} className={`border-t border-slate-100 ${c.on ? "" : "opacity-50"}`}>
                  <td className="py-1.5 pr-3 font-medium text-slate-900">{c.name}{c.status !== "active" ? <span className="block text-xs font-normal text-slate-500">{c.status}</span> : null}</td>
                  <td className="py-1.5 pr-3"><Switch checked={c.on} onCheckedChange={(v) => void saveClient(c, { on: v })} /></td>
                  <td className="py-1.5 pr-3 text-xs text-slate-700">{c.usage ? <>{money(c.usage.costUsd)} · {c.usage.runs} cmd{c.usage.unpricedRuns ? ` (${c.usage.unpricedRuns} not priced)` : ""}<span className="block text-slate-500">{(c.usage.inputTokens / 1000).toFixed(0)}k in / {(c.usage.outputTokens / 1000).toFixed(0)}k out tokens</span></> : <span className="text-slate-400">—</span>}</td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">$</span>
                      <input value={capText} onChange={(e) => setCaps({ ...caps, [c.id]: e.target.value.replace(/[^\d.]/g, "") })} placeholder="no cap" inputMode="decimal" className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      {caps[c.id] !== undefined && caps[c.id] !== (c.cap === null ? "" : String(c.cap)) && <Button size="sm" variant="outline" onClick={() => { void saveClient(c, { cap: caps[c.id] === "" ? null : Number(caps[c.id]) }); setCaps(({ [c.id]: _, ...rest }) => rest); }}>Save</Button>}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-slate-700">{c.phones.active}{c.phones.pending ? <span className="text-amber-700"> · {c.phones.pending} waiting</span> : null}</td>
                  <td className="py-1.5 text-xs text-slate-700">{c.computers.total ? `${c.computers.online}/${c.computers.total} online` : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {!data.clients.length && <p className="mt-2 text-sm text-slate-500">No clients yet.</p>}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Phones</h2>
        <p className="text-xs text-slate-500">{platform
          ? "A phone is set up from the app (System → Command Center) by Timothy or Emily Winn, then approved here. Each phone has its own Face ID key."
          : "An administrator sets up their phone in the FIAREP app (home screen → Command Center → Set up this phone), then it's approved here. Each phone has its own Face ID key."}</p>
        {pendingPhones.map((d) => (
          <div key={d.id} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
            <span className="h-3 w-3 animate-pulse rounded-full bg-amber-500" />
            <div className="min-w-0 flex-1"><p className="font-semibold text-slate-950">{d.name} — {d.staffName}</p><p className="text-xs text-slate-600">Asked {when(d.createdAt)} · Face ID key <code className="break-all">{d.confirmKey}</code></p></div>
            <Button size="sm" onClick={() => void device(d, "approve")}>Approve</Button>
            <Button size="sm" variant="outline" className="text-rose-700" onClick={() => void device(d, "revoke")}>Reject</Button>
          </div>
        ))}
        {otherPhones.length > 0 && (
          <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Phone</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Last used</th><th className="py-1 pr-3">Face ID key (for computers)</th><th /></tr></thead>
            <tbody>{otherPhones.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-3 font-medium text-slate-900">{d.name}<span className="block text-xs text-slate-500">{d.staffName}</span></td>
                <td className={`py-1.5 pr-3 text-xs font-semibold ${d.status === "active" ? "text-emerald-700" : "text-slate-400"}`}>{d.status}{d.approvedBy ? <span className="block font-normal text-slate-500">by {d.approvedBy}</span> : null}</td>
                <td className="py-1.5 pr-3 text-xs text-slate-500">{when(d.lastUsedAt)}</td>
                <td className="py-1.5 pr-3"><button type="button" onClick={() => copy(d.confirmKey, "Face ID key")} className="max-w-[16rem] truncate font-mono text-xs text-slate-600 hover:underline">{d.confirmKey}</button></td>
                <td className="py-1.5 text-right">{d.status === "active" && <Button size="sm" variant="outline" className="text-rose-700" onClick={() => void device(d, "revoke")}>Revoke</Button>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        {data.devices.length === 0 && <p className="mt-3 text-sm text-slate-500">No phones yet.</p>}
      </section>

      {platform && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Backup relay (when FIAREP is down)</h2>
          <p className="text-xs text-slate-500">A Cloudflare Worker outside Replit. When fiarep.com stops answering, the Mac reports it there, your phone gets a push, and a Face ID approval lets the Mac republish on Replit. Only FIAREP's own phones are sent to it.</p>
          {data.relay?.url && data.relay.serverTokenSet ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><code className="text-xs text-slate-700">{data.relay.url}</code><Button size="sm" variant="outline" onClick={() => void syncRelay()}>Send phones to relay</Button></div>
          ) : (
            <p className="mt-2 text-sm text-amber-800">Not connected — run <code>artifacts/fiarep-relay/setup.sh</code> on the Mac, then add <b>RELAY_URL</b> and <b>RELAY_SERVER_TOKEN</b> in Replit Secrets.</p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Computers</h2>
        <p className="text-xs text-slate-500">Windows PCs, Macs and Linux computers. The agent only calls out to FIAREP; nothing connects to the computer. It can only read the folders, open the apps and run the tasks listed in its own settings file on that computer, and with your phones' Face ID keys pinned there, anything that changes something needs your Face ID — checked on the computer itself.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder={platform ? "Name, e.g. Tim's Mac" : "Name, e.g. Front office PC"} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <Button size="sm" onClick={() => void addAgent()} disabled={agentName.trim().length < 2}>Add computer</Button>
        </div>
        {newAgent && (
          <div className="mt-3 rounded-lg border-2 border-[#185FA5] bg-sky-50 p-3 text-sm">
            <p className="font-semibold text-slate-950">Install on {newAgent.name} — this line has its token and is shown once</p>
            <div className="mt-2"><InstallLines lines={newAgent.install} onCopy={copy} /></div>
            <p className="mt-2 text-xs text-slate-600">It pins the Face ID keys of the {data.devices.filter((d) => d.status === "active").length} phone(s) approved above. The computer shows up below as online within a minute.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setNewAgent(null)}>Done</Button>
          </div>
        )}
        {data.agents.map((a) => (
          <details key={a.id} className="mt-3 rounded-lg border border-slate-200 p-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${a.status !== "active" ? "bg-slate-300" : a.online ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span className="font-semibold text-slate-950">{a.name}</span>
              <span className="text-xs text-slate-500">{a.status !== "active" ? "revoked" : a.online ? "online" : `offline · last seen ${when(a.lastSeenAt)}`}{typeof a.info["platform"] === "string" ? ` · ${({ win32: "Windows", darwin: "Mac", linux: "Linux" } as Record<string, string>)[a.info["platform"] as string] ?? a.info["platform"]}` : ""} · {a.tasks.length} task{a.tasks.length === 1 ? "" : "s"}{typeof a.info["pinnedKeys"] === "number" ? ` · ${a.info["pinnedKeys"]} pinned phone key(s)` : ""}</span>
              {a.status === "active" && <Button size="sm" variant="outline" className="ml-auto text-rose-700" onClick={(e) => { e.preventDefault(); void revokeAgent(a); }}>Revoke</Button>}
              {a.status !== "active" && <Button size="sm" variant="outline" className="ml-auto text-slate-600" onClick={(e) => { e.preventDefault(); void removeAgent(a); }}>Remove</Button>}
            </summary>
            <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
              <div><p className="font-semibold text-slate-800">Tasks</p>{a.tasks.map((t) => <p key={t.name}><code>{t.name}</code> — {t.description}{t.confirm ? " · Face ID" : ""}</p>)}{!a.tasks.length && <p>none</p>}</div>
              <div><p className="font-semibold text-slate-800">Folders it can read</p>{a.folders.map((f) => <p key={f} className="break-all">{f}</p>)}{!a.folders.length && <p>none</p>}</div>
              <div><p className="font-semibold text-slate-800">Apps it can open</p><p>{a.apps.join(", ") || "none"}</p></div>
            </div>
          </details>
        ))}
        {data.agents.some((a) => a.status === "active") && (
          <details className="mt-3 rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Approved a new phone? Update a computer</summary>
            <p className="mt-1 text-xs text-slate-600">Run this on the computer. It updates the agent and pins the Face ID keys of every phone approved above; the computer keeps its token.</p>
            <div className="mt-2"><InstallLines lines={data.install} onCopy={copy} /></div>
          </details>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Actions</h2>
        <p className="text-xs text-slate-500">The complete list of what {platform ? "the" : "your"} Command Center can do. Switch any of them off. “Face ID” makes it wait for approval on the phone before it runs. Tasks on a computer also follow their own <code>confirm</code> setting in its settings file.{platform ? " Switching an action off here switches it off for every client too; FIAREP-server actions are never on a client's." : ""}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Action</th><th className="py-1 pr-3">Where</th><th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">On</th><th className="py-1">Face ID</th></tr></thead>
          <tbody>{data.actions.map((a) => (
            <tr key={a.name} className={`border-t border-slate-100 ${on(a.name) ? "" : "opacity-50"}`}>
              <td className="py-1.5 pr-3 font-medium text-slate-900">{a.label}{platformOff(a.name) ? <span className="block text-xs font-normal text-slate-500">off by FIAREP</span> : null}</td>
              <td className="py-1.5 pr-3 text-xs text-slate-500">{a.target === "agent" ? "Computer" : "FIAREP"}</td>
              <td className="py-1.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.risk === "write" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{a.risk === "write" ? "changes something" : "read only"}</span></td>
              <td className="py-1.5 pr-3"><Switch checked={on(a.name)} disabled={platformOff(a.name)} onCheckedChange={(v) => void saveSwitches({ actions: { ...data.switches.actions, [a.name]: v } })} /></td>
              <td className="py-1.5">{a.risk === "write" ? <Switch checked={needsFaceId(a)} onCheckedChange={(v) => void saveSwitches({ confirm: { ...data.switches.confirm, [a.name]: v } })} /> : <span className="text-xs text-slate-400">—</span>}</td>
            </tr>))}
          </tbody>
        </table></div>
        {platform && (
          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">Engine — the model that reads each command</p>
            <p className="text-xs text-slate-500">Same actions, same Face ID approvals and audit trail either way; only the model that understands the command changes. Applies to FIAREP's own and every client's. Voice in / out stays on OpenAI.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["claude", "gemini"] as const).map((p) => (
                <button key={p} type="button" onClick={() => { if (p !== data.switches.provider && window.confirm(p === "gemini" ? `Switch every Command Center to Gemini (${data.switches.geminiModel})?${data.geminiKeyConfigured ? "" : " There's no Gemini API key yet, so commands will fail until you run set-gemini-key.sh."}` : `Switch every Command Center back to Claude (${data.switches.model})?`)) void saveSwitches({ provider: p }); }}
                  className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${data.switches.provider === p ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                  {p === "claude" ? "Claude" : "Gemini"}{data.switches.provider === p ? " · in use" : ""}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-slate-600">Claude</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} className="w-52 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
                <Button size="sm" variant="outline" disabled={!model.trim() || model.trim() === data.switches.model} onClick={() => void saveSwitches({ model: model.trim() })}>Save</Button>
                <span className="w-full text-xs text-slate-500">default {data.defaultModel} · {priceText(data.switches.model)} · key {data.claudeKeyConfigured ? "set" : <b className="text-amber-800">not set (ANTHROPIC_API_KEY)</b>}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-slate-600">Gemini</span>
                <input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className="w-52 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
                <Button size="sm" variant="outline" disabled={!geminiModel.trim() || geminiModel.trim() === data.switches.geminiModel} onClick={() => void saveSwitches({ geminiModel: geminiModel.trim() })}>Save</Button>
                <span className="w-full text-xs text-slate-500">default {data.defaultGeminiModel} · {priceText(data.switches.geminiModel)} · key {data.geminiKey?.set ? `set ${data.geminiKey.source === "terminal" ? "from the Terminal" : "in Replit Secrets"} (…${data.geminiKey.last4})` : <b className="text-amber-800">not set — run set-gemini-key.sh in Terminal</b>}</span>
              </div>
            </div>
            {data.usage ? <p className="mt-2 text-xs text-slate-500">FIAREP's own this month: {money(data.usage.costUsd)}, {data.usage.runs} commands</p> : null}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-950">Resident messages</h2>
            <p className="text-xs text-slate-500">Residents can write about their complaint in the FIAREP app or on the website (from the phone or browser they filed it on). The Command Center answers for the office — status, open times, booking the visit on the crew's calendar — as "{"<company>"} Maintenance". It doesn't announce that it's automated, but if a resident asks whether they're talking to a person, it says it's the office's automated assistant and offers a staff member. Emergencies and anything it can't do go to staff. Reply here yourself at any time; replying takes the conversation over until you give it back. With "Work orders from resident photos" on, Smart Repair reads each complaint photo and drafts a work order with the repair instructions (trade, tools, parts, steps) for the supervisors; assigning it books the member and tells the resident the visit time.</p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-900">Answer residents</span>
              <Switch checked={data.switches.residentChat !== false} onCheckedChange={(v) => void saveSwitches({ residentChat: v })} />
            </label>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" title="Smart Repair reads each resident photo and drafts a work order with repair instructions, then tells the supervisors">
              <span className="font-semibold text-slate-900">Work orders from resident photos</span>
              <Switch checked={data.switches.autoWorkOrders !== false} onCheckedChange={(v) => void saveSwitches({ autoWorkOrders: v })} />
            </label>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {chats.map((c) => (
            <div key={c.id} className={`rounded-lg border p-3 ${c.handoff?.urgent && c.human ? "border-rose-400 bg-rose-50" : c.waiting && c.human ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
              <button type="button" onClick={() => setOpenChat(openChat === c.id ? null : c.id)} className="flex w-full flex-wrap items-center gap-2 text-left">
                <span className="font-semibold text-slate-950">#{c.complaintNo}</span>
                <span className="text-xs text-slate-600">{c.address}{c.unit ? `, apt ${c.unit}` : ""} · {c.description.slice(0, 60)}</span>
                <span className="ml-auto text-xs font-semibold">{c.human ? <span className={c.handoff?.urgent ? "text-rose-700" : "text-amber-800"}>{c.waiting ? "waiting for you" : "staff answering"}{c.handoff?.reason ? ` — ${c.handoff.reason}` : ""}</span> : null}</span>
                {c.appointment && <span className="w-full text-xs text-slate-500">Visit: {c.appointment}</span>}
              </button>
              {openChat === c.id && (
                <div className="mt-2">
                  <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-md bg-slate-50 p-2">
                    {c.messages.map((m) => (
                      <div key={m.id} className={`flex ${m.from === "resident" ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[80%] rounded-xl px-3 py-1.5 text-sm ${m.from === "resident" ? "border border-slate-200 bg-white text-slate-900" : m.from === "staff" ? "bg-slate-800 text-white" : "bg-[#185FA5] text-white"}`}>
                          {m.text}
                          <div className="mt-0.5 text-[10px] opacity-70">{m.from === "resident" ? "Resident" : m.from === "staff" ? m.by || "Staff" : "Assistant"} · {when(m.at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as the office" className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-sm" />
                    <Button size="sm" disabled={!reply.trim()} onClick={() => void chatAction(c, { text: reply.trim() })}>Send</Button>
                    {c.human ? <Button size="sm" variant="outline" onClick={() => void chatAction(c, { giveBack: true })}>Give back to the assistant</Button> : <Button size="sm" variant="outline" onClick={() => void chatAction(c, { takeOver: true })}>Take over</Button>}
                  </div>
                </div>
              )}
            </div>
          ))}
          {!chats.length && <p className="text-sm text-slate-500">No resident messages yet.</p>}
        </div>
      </section>

      {sched && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Scheduling</h2>
          <p className="text-xs text-slate-500">When the Command Center books a member for a job it puts it on the calendar with a start and end time. A member already booked can't be booked again for that time; the next job in another building starts after the drive there{platform ? " (Google Maps with traffic)" : ""}. Jobs in the same building can follow each other with no drive. When a member has this many apartments in one building that day, it becomes a building day: no other building that day. New York time.</p>
          {platform && <p className="mt-1 text-xs text-slate-500">Google Maps key: {data.mapsKey?.set ? `set ${data.mapsKey.source === "terminal" ? "from the Terminal" : "in Replit Secrets"} (…${data.mapsKey.last4})` : <b className="text-amber-800">not set — run set-maps-key.sh in Terminal (until then drive times are a distance estimate)</b>} · Routes API with traffic: $10 per 1,000 lookups after 5,000 free a month (developers.google.com/maps/billing-and-pricing/pricing, Oct 16 2026). Each lookup is kept for 6 hours.</p>}
          {!platform && data.mapsKey && !data.mapsKey.set && <p className="mt-1 text-xs text-slate-500">Drive times are estimated from distance until FIAREP turns on Google Maps.</p>}
          <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col text-xs text-slate-600">Day starts<input type="time" value={sched.dayStart} onChange={(e) => setSched({ ...sched, dayStart: e.target.value })} className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm" /></label>
            <label className="flex flex-col text-xs text-slate-600">Day ends<input type="time" value={sched.dayEnd} onChange={(e) => setSched({ ...sched, dayEnd: e.target.value })} className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm" /></label>
            <div className="flex flex-col text-xs text-slate-600">Work days<div className="mt-1 flex gap-1">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <button key={i} type="button" onClick={() => setSched({ ...sched, workDays: sched.workDays.includes(i) ? sched.workDays.filter((x) => x !== i) : [...sched.workDays, i].sort() })}
                className={`h-8 w-8 rounded-md border text-xs font-semibold ${sched.workDays.includes(i) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600"}`}>{d}</button>))}</div></div>
            <DurationField label="A job takes" value={sched.defaultJobMinutes} onChange={(v) => setSched({ ...sched, defaultJobMinutes: v })} />
            <DurationField label="Per apartment" value={sched.minutesPerApartment} onChange={(v) => setSched({ ...sched, minutesPerApartment: v })} />
            <label className="flex flex-col text-xs text-slate-600">Building day from (apartments)<input type="number" min={2} max={50} value={sched.buildingDayApartments} onChange={(e) => setSched({ ...sched, buildingDayApartments: Number(e.target.value) })} className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1 text-sm" /></label>
            <Button size="sm" variant="outline" disabled={JSON.stringify(sched) === JSON.stringify(data.schedule)} onClick={() => void saveSchedule()}>Save</Button>
          </div>
        </section>
      )}

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-base font-semibold text-slate-950">Work orders prepared by the Command Center ({drafts.length} waiting)</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
          <tbody>{orders.map((o) => (
            <tr key={o.id} className="border-t border-slate-100">
              <td className="py-1.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${o.urgency === "urgent" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700"}`}>{o.urgency}</span></td>
              <td className="py-1.5 pr-3 font-medium text-slate-900">{[o.address, o.borough].filter(Boolean).join(", ")}<span className="block text-xs font-normal text-slate-500">{o.kind} · {o.title}</span></td>
              <td className="py-1.5 pr-3 text-xs text-slate-600">{o.status === "assigned" && o.assignedName ? `assigned to ${o.assignedName}` : o.status}{o.decidedBy ? ` · ${o.decidedBy}` : ""}</td>
              <td className="py-1.5 text-xs text-slate-500">{when(o.createdAt)}</td>
            </tr>))}
          </tbody>
        </table></div>
        {!orders.length && <p className="mt-2 text-sm text-slate-500">None yet.</p>}
      </details>

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-base font-semibold text-slate-950">Reports written by the Command Center ({reports.length})</summary>
        <div className="mt-3 divide-y divide-slate-100">{reports.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{r.title}</span>
            <span className="text-xs text-slate-500">{r.createdBy} · {when(r.createdAt)}</span>
            <Button size="sm" variant="outline" onClick={() => void openReport(r)}>Open</Button>
          </div>))}
        </div>
        {!reports.length && <p className="mt-2 text-sm text-slate-500">None yet. Ask the Command Center for a report (for example "write a report on this week's complaints").</p>}
      </details>

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-base font-semibold text-slate-950">
          Audit trail ({platform ? data.audit.rows : audit.length} entries) ·{" "}
          {data.audit.ok ? <span className="text-emerald-700">chain intact</span> : <span className="text-rose-700">chain BROKEN{data.audit.brokenAt ? ` at entry #${data.audit.brokenAt}` : ""} — a row was edited or deleted</span>}
        </summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-xs">
          <tbody>{audit.map((r) => (
            <tr key={r.seq} className="border-t border-slate-100 align-top">
              <td className="py-1 pr-3 whitespace-nowrap text-slate-500">#{r.seq} · {when(r.at)}</td>
              <td className="py-1 pr-3 whitespace-nowrap font-medium text-slate-800">{r.actor}</td>
              <td className="py-1 pr-3 whitespace-nowrap text-slate-700">{r.event}</td>
              <td className="py-1 font-mono text-slate-500 break-all">{JSON.stringify(r.detail).slice(0, 220)}</td>
            </tr>))}
          </tbody>
        </table></div>
      </details>
    </div>
  );
}
