import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type ActionMeta = { name: string; label: string; risk: "read" | "write"; confirmDefault: boolean; target: "server" | "agent" };
type Switches = { enabled: boolean; actions: Record<string, boolean>; confirm: Record<string, boolean>; model: string };
type Device = { id: string; name: string; staffName: string; status: "pending" | "active" | "revoked"; confirmKey: string; createdAt: string; approvedAt: string | null; approvedBy: string | null; lastUsedAt: string | null };
type AgentTask = { name: string; description: string; confirm: boolean; params: Record<string, { description: string; pattern: string }> };
type Agent = { id: string; name: string; status: string; online: boolean; lastSeenAt: string | null; info: Record<string, unknown>; tasks: AgentTask[]; folders: string[]; apps: string[]; createdAt: string };
type Overview = { switches: Switches; defaultModel: string; claudeKeyConfigured: boolean; voiceKeyConfigured: boolean; actions: ActionMeta[]; devices: Device[]; agents: Agent[]; audit: { ok: boolean; rows: number; brokenAt: number | null } };
type AuditRow = { seq: number; at: string; actor: string; event: string; detail: Record<string, unknown> };
type WorkOrder = { id: string; status: string; urgency: string; address: string; borough: string; kind: string; title: string; createdAt: string; decidedBy: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const api = <T,>(path: string, init: Record<string, unknown> = {}) => customFetch<T>(`/api${path}`, { responseType: "json", ...init } as never);
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Platform Control → Command Center: the phone's remote control for FIAREP
 *  and the Mac. Every action is listed with its own on/off switch and its own
 *  Face ID switch; phones and computers are approved and revoked here. */
export default function OwnerCommandCenter() {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [agentName, setAgentName] = useState("");
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);
  const [model, setModel] = useState("");
  const fail = (title: string) => (err: any) => toast({ variant: "destructive", title, description: err?.data?.error || err?.message });

  async function load() {
    try {
      const [o, a, w] = await Promise.all([
        api<Overview>("/v1/platform/command"),
        api<{ rows: AuditRow[] }>("/v1/platform/command/audit?limit=200"),
        api<WorkOrder[]>("/v1/platform/command/work-orders"),
      ]);
      setData(o); setAudit(a.rows); setOrders(w); setModel((m) => m || o.switches.model);
    } catch (err) { fail("Could not load the Command Center")(err); }
  }
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveSwitches(patch: Partial<Switches>) {
    if (!data) return;
    const next = { ...data.switches, ...patch };
    setData({ ...data, switches: next });
    try { await api("/v1/platform/command/switches", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }); }
    catch (err) { fail("Could not save")(err); await load(); }
  }
  const on = (name: string) => data?.switches.actions[name] !== false;
  const needsFaceId = (a: ActionMeta) => (typeof data?.switches.confirm[a.name] === "boolean" ? data.switches.confirm[a.name]! : a.confirmDefault);

  async function device(d: Device, decision: "approve" | "revoke") {
    if (decision === "revoke" && !window.confirm(`Revoke ${d.name}? It can't send commands until it's set up and approved again.`)) return;
    try { await api(`/v1/platform/command/devices/${encodeURIComponent(d.id)}/${decision}`, { method: "POST" }); await load(); } catch (err) { fail("Could not update the phone")(err); }
  }
  async function addAgent() {
    try { const r = await api<{ name: string; token: string }>("/v1/platform/command/agents", json({ name: agentName.trim() })); setNewToken(r); setAgentName(""); await load(); }
    catch (err) { fail("Could not add the computer")(err); }
  }
  async function revokeAgent(a: Agent) {
    if (!window.confirm(`Revoke ${a.name}? Its token stops working immediately.`)) return;
    try { await api(`/v1/platform/command/agents/${encodeURIComponent(a.id)}/revoke`, { method: "POST" }); await load(); } catch (err) { fail("Could not revoke")(err); }
  }
  const copy = (text: string, what: string) => { void navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); };

  if (!data) return <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading…</p>;
  const pendingPhones = data.devices.filter((d) => d.status === "pending");
  const otherPhones = data.devices.filter((d) => d.status !== "pending");
  const drafts = orders.filter((o) => o.status === "draft");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Command Center</h1>
          <p className="text-sm text-slate-500">Talk to FIAREP and your computer from the phone. Reads answer right away; anything that changes something can wait for Face ID on the phone. Every step is written to a tamper-evident audit trail.</p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-sm font-semibold text-slate-900">Command Center {data.switches.enabled ? "ON" : "OFF"}</span>
          <Switch checked={data.switches.enabled} onCheckedChange={(v) => void saveSwitches({ enabled: v })} />
        </label>
      </div>

      {(!data.claudeKeyConfigured || !data.voiceKeyConfigured) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {!data.claudeKeyConfigured && <p><b>ANTHROPIC_API_KEY</b> is not set on the API server — commands can't be understood until it is (Replit → Secrets).</p>}
          {!data.voiceKeyConfigured && <p><b>OPENAI_API_KEY</b> is not set — voice in/out won't work (typing still does).</p>}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Phones</h2>
        <p className="text-xs text-slate-500">A phone is set up from the app (System → Command Center) by Timothy or Emily Winn, then approved here. Each phone has its own Face ID key.</p>
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
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Phone</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Last used</th><th className="py-1 pr-3">Face ID key (for the Mac)</th><th /></tr></thead>
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

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Computers</h2>
        <p className="text-xs text-slate-500">The desktop agent only calls out to FIAREP; nothing connects to the computer. It can only run the tasks, folders and apps listed in its own config file on that computer.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Name, e.g. Tim's Mac" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <Button size="sm" onClick={() => void addAgent()} disabled={agentName.trim().length < 2}>Add computer</Button>
        </div>
        {newToken && (
          <div className="mt-3 rounded-lg border-2 border-[#185FA5] bg-sky-50 p-3 text-sm">
            <p className="font-semibold text-slate-950">Token for {newToken.name} — shown once</p>
            <button type="button" onClick={() => copy(newToken.token, "Token")} className="mt-1 block w-full break-all rounded bg-white p-2 text-left font-mono text-xs hover:bg-slate-50">{newToken.token}</button>
            <p className="mt-2 text-xs text-slate-600">On the Mac: run <code>./install-mac.sh</code> from <code>artifacts/fiarep-agent</code>, paste this token into <code>~/.fiarep-agent/config.json</code>, add your phone's Face ID key to <code>trustedConfirmKeys</code>, run <code>./install-mac.sh</code> again.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setNewToken(null)}>Done</Button>
          </div>
        )}
        {data.agents.map((a) => (
          <details key={a.id} className="mt-3 rounded-lg border border-slate-200 p-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${a.status !== "active" ? "bg-slate-300" : a.online ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span className="font-semibold text-slate-950">{a.name}</span>
              <span className="text-xs text-slate-500">{a.status !== "active" ? "revoked" : a.online ? "online" : `offline · last seen ${when(a.lastSeenAt)}`} · {a.tasks.length} task{a.tasks.length === 1 ? "" : "s"}{typeof a.info["pinnedKeys"] === "number" ? ` · ${a.info["pinnedKeys"]} pinned phone key(s)` : ""}</span>
              {a.status === "active" && <Button size="sm" variant="outline" className="ml-auto text-rose-700" onClick={(e) => { e.preventDefault(); void revokeAgent(a); }}>Revoke</Button>}
            </summary>
            <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
              <div><p className="font-semibold text-slate-800">Tasks</p>{a.tasks.map((t) => <p key={t.name}><code>{t.name}</code> — {t.description}{t.confirm ? " · Face ID" : ""}</p>)}{!a.tasks.length && <p>none</p>}</div>
              <div><p className="font-semibold text-slate-800">Folders it can read</p>{a.folders.map((f) => <p key={f} className="break-all">{f}</p>)}{!a.folders.length && <p>none</p>}</div>
              <div><p className="font-semibold text-slate-800">Apps it can open</p><p>{a.apps.join(", ") || "none"}</p></div>
            </div>
          </details>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Actions</h2>
        <p className="text-xs text-slate-500">The complete list of what the Command Center can do. Switch any of them off. “Face ID” makes it wait for your approval on the phone before it runs. Tasks on the computer also follow their own <code>confirm</code> setting in its config.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Action</th><th className="py-1 pr-3">Where</th><th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">On</th><th className="py-1">Face ID</th></tr></thead>
          <tbody>{data.actions.map((a) => (
            <tr key={a.name} className={`border-t border-slate-100 ${on(a.name) ? "" : "opacity-50"}`}>
              <td className="py-1.5 pr-3 font-medium text-slate-900">{a.label}</td>
              <td className="py-1.5 pr-3 text-xs text-slate-500">{a.target === "agent" ? "Computer" : "FIAREP"}</td>
              <td className="py-1.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.risk === "write" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{a.risk === "write" ? "changes something" : "read only"}</span></td>
              <td className="py-1.5 pr-3"><Switch checked={on(a.name)} onCheckedChange={(v) => void saveSwitches({ actions: { ...data.switches.actions, [a.name]: v } })} /></td>
              <td className="py-1.5">{a.risk === "write" ? <Switch checked={needsFaceId(a)} onCheckedChange={(v) => void saveSwitches({ confirm: { ...data.switches.confirm, [a.name]: v } })} /> : <span className="text-xs text-slate-400">—</span>}</td>
            </tr>))}
          </tbody>
        </table></div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Claude model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="w-56 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
          <Button size="sm" variant="outline" disabled={!model.trim() || model.trim() === data.switches.model} onClick={() => void saveSwitches({ model: model.trim() })}>Save</Button>
          <span className="text-xs text-slate-500">default {data.defaultModel}</span>
        </div>
      </section>

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-base font-semibold text-slate-950">Work orders prepared by the Command Center ({drafts.length} waiting)</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
          <tbody>{orders.map((o) => (
            <tr key={o.id} className="border-t border-slate-100">
              <td className="py-1.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${o.urgency === "urgent" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700"}`}>{o.urgency}</span></td>
              <td className="py-1.5 pr-3 font-medium text-slate-900">{o.address}, {o.borough}<span className="block text-xs font-normal text-slate-500">{o.kind} · {o.title}</span></td>
              <td className="py-1.5 pr-3 text-xs text-slate-600">{o.status}{o.decidedBy ? ` · ${o.decidedBy}` : ""}</td>
              <td className="py-1.5 text-xs text-slate-500">{when(o.createdAt)}</td>
            </tr>))}
          </tbody>
        </table></div>
        {!orders.length && <p className="mt-2 text-sm text-slate-500">None yet.</p>}
      </details>

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-base font-semibold text-slate-950">
          Audit trail ({data.audit.rows} entries) ·{" "}
          {data.audit.ok ? <span className="text-emerald-700">chain intact</span> : <span className="text-rose-700">chain BROKEN at entry #{data.audit.brokenAt} — a row was edited or deleted</span>}
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
