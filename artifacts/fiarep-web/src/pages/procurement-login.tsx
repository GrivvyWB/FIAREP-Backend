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
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [showChallenge, setShowChallenge] = useState(true);
  const pendingRaw = sessionStorage.getItem("fiarep_procurement_verification_pending");
  let pending: { challengeCode: string; challengeToken: string } | null = null;
  try {
    pending = pendingRaw ? JSON.parse(pendingRaw) : null;
  } catch {
    pending = null;
  }

  useEffect(() => {
    if (!isAuthenticated && !pending?.challengeCode && !pending?.challengeToken) {
      setLocation("/login");
      return;
    }
    if (isAuthenticated && staff?.role === "procurement") setLocation("/procurement");
  }, [isAuthenticated, pending?.challengeCode, pending?.challengeToken, staff, setLocation]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowChallenge(false), 5_000);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (!pending) throw new Error("Procurement verification expired. Start again.");
      await procurementLogin(name, code.toUpperCase(), verificationCode, pending.challengeToken);
      sessionStorage.removeItem("fiarep_procurement_verification_pending");
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
          <p className="mt-2 text-sm text-slate-400">Enter your Procurement credentials again, then type the verification number shown below.</p>
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required className="bg-slate-800 border-slate-700" />
        <Input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, 4))}
          placeholder="Issued 4-character code"
          autoComplete="off"
          minLength={4}
          maxLength={4}
          required
          className="bg-slate-800 border-slate-700 uppercase"
        />
        <div className="rounded-lg border border-amber-400/40 bg-slate-800 p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Verification number</p>
          {showChallenge ? (
            <p className="mt-2 text-3xl font-bold tracking-[0.35em] text-amber-400">{pending?.challengeCode}</p>
          ) : (
            <p className="mt-2 text-sm font-medium text-slate-500">Number hidden</p>
          )}
        </div>
        <Input
          value={verificationCode}
          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 2))}
          placeholder="Enter the 2-digit number"
          inputMode="numeric"
          pattern="[0-9]{2}"
          minLength={2}
          maxLength={2}
          required
          className="bg-slate-800 border-slate-700 text-center tracking-[0.35em]"
        />
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Signing in..." : "Sign in to Procurement"}</Button>
        <button type="button" onClick={() => {
          sessionStorage.removeItem("fiarep_procurement_verification_pending");
          setLocation("/login");
        }} className="w-full text-sm text-slate-400 hover:text-white">Return to staff sign-in</button>
      </form>
    </div>
  );
}