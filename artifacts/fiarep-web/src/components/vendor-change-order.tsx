import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Camera, X } from "lucide-react";

// An awarded vendor, on site, raises a change work order: what changed, why,
// measurements, notes and photos (all required). It goes to the CPM Supervisor
// handling the scope; the vendor sees who received it and every decision here.

type VendorCO = {
  id: string; createdAt: string; status: string; description: string; vendorReason: string; measurements: string;
  notes: string; cost: number; photoCount: number; receivedBy: string[]; receivedAt: string;
  respondedByName: string; respondedAt: string; reason: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Received — awaiting supervisor review", cls: "bg-amber-100 text-amber-800" },
  mgmt_approved: { label: "Approved by supervisor — with Procurement for cost", cls: "bg-blue-100 text-blue-800" },
  cost_approved: { label: "Approved — go ahead", cls: "bg-emerald-100 text-emerald-800" },
  declined: { label: "Declined", cls: "bg-red-100 text-red-800" },
};

async function shrink(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally { URL.revokeObjectURL(url); }
}

export function VendorChangeOrder({ trackingId, vendorName, started, completed }: { trackingId: string; vendorName: string; started: boolean; completed: boolean }) {
  const { toast } = useToast();
  const [list, setList] = useState<VendorCO[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [measurements, setMeasurements] = useState("");
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/public/vendor-scopes/${encodeURIComponent(trackingId)}/change-orders?vendorName=${encodeURIComponent(vendorName)}`);
      if (r.ok) setList(await r.json());
    } catch { /* keep what we have */ }
  }, [trackingId, vendorName]);
  useEffect(() => { void load(); }, [load]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const next: string[] = [];
    for (const f of Array.from(files).slice(0, 6 - photos.length)) {
      try { next.push(await shrink(f)); } catch { /* skip bad file */ }
    }
    setPhotos((p) => [...p, ...next].slice(0, 6));
  }

  async function submit() {
    const missing = [!description.trim() && "what changed", !reason.trim() && "why", !measurements.trim() && "measurements", !notes.trim() && "notes", !photos.length && "at least one photo"].filter(Boolean);
    if (missing.length) { toast({ variant: "destructive", title: "Change work order incomplete", description: `Please add ${missing.join(", ")}.` }); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/public/vendor-scopes/${encodeURIComponent(trackingId)}/change-orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorName, description: description.trim(), reason: reason.trim(), measurements: measurements.trim(), notes: notes.trim(), cost: Number(cost) || 0, photos }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload?.error || "Could not send the change work order");
      const who = (payload?.receivedBy || []).join(" and ");
      toast({ title: "Change work order sent", description: who ? `Received by ${who}. You'll see their decision here.` : "Sent to the chain of command. You'll see their decision here." });
      setDescription(""); setReason(""); setMeasurements(""); setNotes(""); setCost(""); setPhotos([]); setOpen(false);
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Not sent", description: e?.message || "Try again." });
    } finally { setBusy(false); }
  }

  return (
    <Card className="shadow-lg border-border/50" data-testid="card-vendor-change-orders">
      <CardHeader>
        <CardTitle>Change work orders</CardTitle>
        <CardDescription>Found more than the scope covers? Raise a change work order from the site with photos. It goes to the supervisor handling this scope; you'll see here when it's received, approved or declined.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!completed && (
          started ? (
            !open ? (
              <Button className="w-full" variant="outline" onClick={() => setOpen(true)}>Change work order</Button>
            ) : (
              <div className="space-y-3 rounded-xl border p-3">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What changed / extra work needed (required)" />
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — the reason this is outside the scope (required)" />
                <Input value={measurements} onChange={(e) => setMeasurements(e.target.value)} placeholder="Measurements, e.g. 12 ft × 8 ft wall, 40 sq ft (required)" />
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (required)" />
                <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Added cost $ (optional)" />
                <input ref={fileInput} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
                <Button type="button" variant="outline" className="w-full" onClick={() => fileInput.current?.click()} disabled={photos.length >= 6}>
                  <Camera className="mr-2 h-4 w-4" />{photos.length ? `Add another photo (${photos.length}/6)` : "Take photos (required)"}
                </Button>
                {!!photos.length && (
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative">
                        <img src={p} alt={`Photo ${i + 1}`} className="h-24 w-full rounded-lg border object-cover" />
                        <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send to supervisor"}</Button>
                  <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                </div>
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Press <span className="font-semibold">Start work</span> above once you're on site to raise a change work order.</p>
          )
        )}
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No change work orders on this job yet.</p>
        ) : list.map((co) => {
          const st = STATUS[co.status] || { label: co.status, cls: "bg-muted text-foreground" };
          return (
            <div key={co.id} className="rounded-xl border p-3 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{new Date(co.createdAt).toLocaleString()}{co.photoCount ? ` · ${co.photoCount} photo${co.photoCount === 1 ? "" : "s"}` : ""}</p>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>
              </div>
              <p className="text-sm"><span className="font-semibold">What changed: </span>{co.description}</p>
              <p className="text-sm"><span className="font-semibold">Why: </span>{co.vendorReason}</p>
              <p className="text-sm"><span className="font-semibold">Measurements: </span>{co.measurements}</p>
              {!!co.cost && <p className="text-sm"><span className="font-semibold">Added cost: </span>${co.cost.toFixed(2)}</p>}
              {!!co.receivedBy.length && <p className="text-xs text-emerald-700">✓ Received by {co.receivedBy.join(" and ")}{co.receivedAt ? ` · ${new Date(co.receivedAt).toLocaleString()}` : ""}</p>}
              {co.status !== "submitted" && !!co.respondedByName && <p className="text-xs text-muted-foreground">{st.label} by {co.respondedByName}{co.respondedAt ? ` · ${new Date(co.respondedAt).toLocaleString()}` : ""}</p>}
              {co.status === "declined" && !!co.reason && <p className="text-sm text-red-700">Reason: {co.reason}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
