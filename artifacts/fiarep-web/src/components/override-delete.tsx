import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";

// Deleting on the website. Administrators delete directly. Upper management
// (Borough / Regional / Asst Regional Director, Property Manager, APM) gets a
// one-time three-digit override code from the server, types it back, and the
// delete goes through with the code — which is written on the audit trail and
// sent to the record's supervisor so everyone knows who deleted what.
type Pending = { entity: string; id: string; version: number; label: string; resolve: (ok: boolean) => void };

export function useOverrideDelete() {
  const { staff } = useAuth();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsCode = staff?.role === "management";

  async function doDelete(entity: string, id: string, version: number, overrideCode?: string) {
    await customFetch<void>(`/api/v1/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, ...(overrideCode ? { overrideCode } : {}) }),
    });
  }

  /** Resolves true when deleted, false when cancelled; throws on a server refusal. */
  function remove(entity: string, id: string, version: number, label: string): Promise<boolean> {
    if (!needsCode) return doDelete(entity, id, version).then(() => true);
    return new Promise<boolean>((resolve) => {
      setError(""); setTyped(""); setCode("");
      setPending({ entity, id, version, label, resolve });
      customFetch<{ code: string; expiresAt: string }>("/api/v1/delete-override", { method: "POST" })
        .then((r) => { setCode(r.code); setExpiresAt(r.expiresAt); })
        .catch((e: any) => setError(e?.message || "Could not get an override code."));
    });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      await doDelete(pending.entity, pending.id, pending.version, typed.trim());
      pending.resolve(true);
      setPending(null);
    } catch (e: any) {
      setError(e?.message || "The server refused the delete.");
    } finally { setBusy(false); }
  }
  function cancel() { pending?.resolve(false); setPending(null); }

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override code to delete</DialogTitle>
          <DialogDescription>
            You are deleting: <span className="font-semibold text-foreground">{pending?.label}</span>. This removes it, and the work that came out of it, for everyone. The supervisor it was with will see that you deleted it, with this code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-center">
            <p className="text-xs uppercase tracking-wide text-amber-800">Your override code{expiresAt ? " · good for 10 minutes" : ""}</p>
            <p className="font-mono text-3xl font-bold tracking-[0.3em] text-amber-900">{code || "···"}</p>
          </div>
          <Input value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="Type the code to confirm" inputMode="numeric" className="text-center font-mono text-lg tracking-widest" autoFocus />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy || typed.trim().length !== 3 || !code}>{busy ? "Deleting…" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { remove, dialog, needsCode };
}
