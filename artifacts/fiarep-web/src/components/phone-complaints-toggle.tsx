import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Smartphone } from "lucide-react";
import { Switch } from "@/components/ui/switch";

/** "Complaints on my phone" — the same switch as in the app. Off: complaints
 *  still come in here on the platform and in the app's Inbox, but the phone is
 *  not buzzed for each one. */
export function PhoneComplaintsToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    customFetch<{ on: boolean }>("/api/v1/notifications/phone-complaints", { responseType: "json" } as never)
      .then((r) => setOn(r?.on !== false)).catch(() => setOn(null));
  }, []);
  if (on === null) return null;
  const change = async (next: boolean) => {
    setOn(next); setSaving(true);
    try { await customFetch("/api/v1/notifications/phone-complaints", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: next }), responseType: "json" } as never); }
    catch { setOn(!next); }
    finally { setSaving(false); }
  };
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${on ? "border-[#185FA5]/40 bg-blue-50/50" : "border-slate-200 bg-slate-50"}`}>
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-blue-100 text-[#185FA5]" : "bg-slate-200 text-slate-500"}`}><Smartphone className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">Complaints on my phone</p>
        <p className="text-xs text-slate-500">{on ? "Each new complaint also buzzes your phone in the FIAREP app." : "Off — complaints come in here on the platform and in the app's Inbox only; your phone isn't buzzed."}</p>
      </div>
      <Switch checked={on} onCheckedChange={(v) => void change(v)} disabled={saving} aria-label="Complaints on my phone" />
    </div>
  );
}
