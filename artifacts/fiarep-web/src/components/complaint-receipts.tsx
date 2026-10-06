import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getListEntityRecordsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Clock, Eye } from "lucide-react";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
type Receipt = { id: string; name: string; position: string; at: string };
type Eta = { eta: string; crew: string; note: string; byName: string; byPosition: string; at: string };
const list = (v: unknown): Receipt[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && typeof x.id === "string") : []);
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/**
 * Who was told, who opened it (green light / red light), and "on my way".
 * Mounting it marks the complaint as opened by the signed-in person, and
 * whoever sent it is told.
 */
export function ComplaintReceipts({ entity, reportId, state, canSendEta }: {
  entity: "resident-reports" | "building-violations";
  reportId: string;
  state: Record<string, unknown>;
  canSendEta: boolean;
}) {
  const { staff } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [opens, setOpens] = useState<Receipt[]>(list(state.opens));
  const [eta, setEta] = useState<Eta | null>((state.eta as Eta) || null);
  const [options, setOptions] = useState<{ eta: string[]; crew: string[] }>({ eta: [], crew: [] });
  const [pickEta, setPickEta] = useState("");
  const [pickCrew, setPickCrew] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const notified = list(state.notifiedStaff);
  const isManagement = staff?.role === "management" || staff?.role === "administrator";

  useEffect(() => {
    customFetch<{ opens: Receipt[] }>(`/api/v1/${entity}/${encodeURIComponent(reportId)}/opened`, { method: "POST", responseType: "json" } as never)
      .then((r) => { if (Array.isArray(r?.opens) && r.opens.length) setOpens(r.opens); })
      .catch(() => undefined);
    if (canSendEta) customFetch<{ eta: string[]; crew: string[] }>("/api/v1/eta-options", { responseType: "json" } as never).then(setOptions).catch(() => undefined);
  }, [entity, reportId, canSendEta]);

  async function sendEta() {
    if (!pickEta && !pickCrew) { toast({ variant: "destructive", title: "Pick a time or a crew" }); return; }
    setBusy(true);
    try {
      const r = await customFetch<{ eta: Eta }>(`/api/v1/${entity}/${encodeURIComponent(reportId)}/eta`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eta: pickEta, crew: pickCrew, note: note.trim() }), responseType: "json",
      } as never);
      setEta(r.eta); setPickEta(""); setPickCrew(""); setNote("");
      toast({ title: "Sent", description: [r.eta.eta, r.eta.crew ? `${r.eta.crew} on the way` : ""].filter(Boolean).join(" · ") });
      await queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey(entity) });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not send", description: error instanceof Error ? error.message : "Try again." });
    } finally { setBusy(false); }
  }

  const openedBy = (id: string) => opens.find((o) => o.id === id);
  // Everyone who should know about it: who it was sent to, plus anyone who opened it anyway.
  const people = [...notified, ...opens.filter((o) => !notified.some((n) => n.id === o.id)).map((o) => ({ ...o, at: "" }))];

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      {eta && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm">
          <p className="font-semibold text-emerald-900 flex items-center gap-1"><Clock className="h-4 w-4" />{eta.eta}{eta.crew ? ` · ${eta.crew} on the way` : ""}</p>
          <p className="text-xs text-emerald-800">{eta.byName} ({eta.byPosition}) · {when(eta.at)}{eta.note ? ` · ${eta.note}` : ""}</p>
        </div>
      )}
      {isManagement && (
        <div>
          <p className="text-sm font-semibold flex items-center gap-1"><Eye className="h-4 w-4" />Who opened it</p>
          {people.length === 0 ? <p className="text-xs text-muted-foreground">Nobody has been sent this yet.</p> : (
            <ul className="mt-1 space-y-1">
              {people.map((p) => {
                const o = openedBy(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <span className={`inline-block h-3 w-3 rounded-full ${o ? "bg-emerald-500" : "bg-red-500"}`} title={o ? "Opened" : "Never opened"} />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">{p.position}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{o ? `opened ${when(o.at)}` : "never opened"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {canSendEta && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Let them know you're coming</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={selectClass} value={pickEta} onChange={(e) => setPickEta(e.target.value)}>
              <option value="">When — pick one</option>
              {options.eta.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select className={selectClass} value={pickCrew} onChange={(e) => setPickCrew(e.target.value)}>
              <option value="">Who's coming (optional)</option>
              {options.crew.map((o) => <option key={o} value={o}>{o} on the way</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            <Button onClick={() => void sendEta()} disabled={busy || (!pickEta && !pickCrew)}>{busy ? "Sending…" : "Send"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
