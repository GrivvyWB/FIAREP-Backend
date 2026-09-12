import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function ProcurementLogin() {
  const [, setLocation] = useLocation();
  const { procurementLogin, isAuthenticated, staff } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated && staff?.role === "procurement") setLocation("/procurement");
  }, [isAuthenticated, staff, setLocation]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await procurementLogin(name, code.toUpperCase(), organizationId.trim());
      setLocation("/procurement");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Procurement sign-in failed", description: error?.message || "Invalid credentials" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-8 text-white shadow-xl space-y-5">
        <div>
          <div className="text-sm font-bold tracking-widest text-amber-400">FIAREP PROCUREMENT</div>
          <h1 className="mt-2 text-2xl font-bold">Procurement sign-in</h1>
          <p className="mt-2 text-sm text-slate-400">Use your approved Procurement account and organization code.</p>
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required className="bg-slate-800 border-slate-700" />
        <Input value={code} onChange={(e) => setCode(e.target.value.slice(0, 4))} placeholder="Issued 4-character code" minLength={4} maxLength={4} required className="bg-slate-800 border-slate-700 uppercase" />
        <Input value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} placeholder="Organization ID" autoComplete="off" required className="bg-slate-800 border-slate-700" />
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Signing in..." : "Sign in to Procurement"}</Button>
        <button type="button" onClick={() => setLocation("/login")} className="w-full text-sm text-slate-400 hover:text-white">Return to staff sign-in</button>
      </form>
    </div>
  );
}