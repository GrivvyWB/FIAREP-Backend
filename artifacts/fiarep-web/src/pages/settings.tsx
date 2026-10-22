import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { User, LogOut, Shield, Calculator, ChevronDown, CircleHelp, Languages, Shapes } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { BUTTON_GUIDE } from "@/lib/button-guide";
import { FEATURE_GUIDE } from "@/lib/feature-guide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { canReadSharedDefaultRates, hasModuleAccess } from "@/lib/access-policy";

const DEFAULT_RATES = {
  waste: 1.12,
  sheetCost: 16,
  laborPerSqFt: 2.1,
  paintPerSqFt: 0.85,
  floorPerSqFt: 5.5,
};

export default function Settings() {
  const { staff, logout, organizationModules } = useAuth();
  const { toast } = useToast();
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesSaving, setRatesSaving] = useState(false);
  // "Only the Borough Director changes shared default rates" is a read-only lock
  // switched in Platform Control; off unless switched on.
  const ratesLocked = organizationModules["lock.defaultRatesDirectorOnly"] === true;
  const canEditRates = staff?.position === "Borough Director" || (!ratesLocked && (staff?.role === "administrator" || staff?.role === "management"));
  const canReadRates = canReadSharedDefaultRates(staff);
  const isHumanResources = staff?.role === "human_resources";

  // Your language: the Command Center speaks it. Forms stay in English (US forms).
  const [langs, setLangs] = useState<Array<{ code: string; name: string; native: string }>>([]);
  const [lang, setLang] = useState("");
  const [langSaving, setLangSaving] = useState(false);
  useEffect(() => {
    void customFetch<{ current: { code: string } | null; languages: Array<{ code: string; name: string; native: string }> }>("/api/v1/me/language", { responseType: "json" } as never)
      .then((r) => { setLangs(r.languages); setLang(r.current?.code || ""); }).catch(() => undefined);
  }, []);
  async function saveLang(code: string) {
    setLang(code); setLangSaving(true);
    try {
      const r = await customFetch<{ language: string }>("/api/v1/me/language", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), responseType: "json" } as never);
      toast({ title: `Language: ${r.language}` });
    } catch (err: any) { toast({ variant: "destructive", title: "Could not save", description: err?.data?.error || err?.message }); }
    finally { setLangSaving(false); }
  }

  useEffect(() => {
    if (isHumanResources || !canReadRates) {
      setRatesLoading(false);
      return;
    }
    let cancelled = false;
    fetch("/api/v1/settings/default-rates", {
      headers: { Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}` },
    })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Unable to load shared rates.");
        return response.json() as Promise<{ value?: Partial<typeof DEFAULT_RATES> }>;
      })
      .then((setting) => {
        if (!cancelled && setting?.value) setRates({ ...DEFAULT_RATES, ...setting.value });
      })
      .catch((error: any) => {
        if (!cancelled) toast({ variant: "destructive", title: "Unable to load rates", description: error?.message || "Please try again." });
      })
      .finally(() => { if (!cancelled) setRatesLoading(false); });
    return () => { cancelled = true; };
  }, [isHumanResources, canReadRates, toast]);

  const saveRates = async () => {
    try {
      setRatesSaving(true);
      const response = await fetch("/api/v1/settings/default-rates", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}`,
        },
        body: JSON.stringify({ value: rates }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to save shared rates.");
      }
      toast({ title: "Default rates saved", description: "Mobile devices will receive these rates during synchronization." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to save rates", description: error?.message || "Please try again." });
    } finally {
      setRatesSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your session and profile.</p>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3d6fa8] to-[#185FA5] text-white grid place-items-center font-bold text-2xl shrink-0">
              {staff?.name?.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-bold">{staff?.name}</h2>
              <p className="text-muted-foreground">{staff?.position || "Staff Member"}</p>
            </div>
          </div>
        </div>
        
        <div className="p-6 space-y-8">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <User className="w-4 h-4" /> Profile Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                <div className="text-xs text-muted-foreground font-medium mb-1">Role</div>
                <div className="font-semibold capitalize">{staff?.role || "-"}</div>
              </div>
              <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                <div className="text-xs text-muted-foreground font-medium mb-1">Status</div>
                <div className="font-semibold capitalize">{staff?.status || "Active"}</div>
              </div>
            </div>
          </div>

          {langs.length > 0 && (
            <details className="group bg-secondary/50 rounded-xl border border-border" data-testid="section-language">
              <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-semibold">
                <span className="flex items-center gap-2"><Languages className="h-4 w-4" /> Language{lang ? <span className="font-normal text-muted-foreground">· {langs.find((l) => l.code === lang)?.name}</span> : null}</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-border px-4 py-3 space-y-2">
                <select className="h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm" value={lang} disabled={langSaving} onChange={(e) => void saveLang(e.target.value)} aria-label="Your language">
                  <option value="" disabled>Pick your language…</option>
                  {langs.map((l) => <option key={l.code} value={l.code}>{l.native === l.name ? l.name : `${l.native} — ${l.name}`}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">The Command Center talks to you in this language.</p>
              </div>
            </details>
          )}

          {!isHumanResources && canReadRates && <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Calculator className="w-4 h-4" /> Shared Default Rates
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                ["waste", "Waste multiplier"],
                ["sheetCost", "Drywall sheet cost"],
                ["laborPerSqFt", "Labor per sq. ft."],
                ["paintPerSqFt", "Paint per sq. ft."],
                ["floorPerSqFt", "Flooring per sq. ft."],
              ].map(([key, label]) => (
                <label key={key} className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={!canEditRates || ratesLoading}
                    value={rates[key as keyof typeof rates]}
                    onChange={(event) => setRates((current) => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))}
                  />
                </label>
              ))}
            </div>
            {canEditRates ? (
              <Button
                onClick={saveRates}
                disabled={ratesLoading || ratesSaving}
              >
                Save shared rates
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Only the Borough Director can change shared default rates.</p>
            )}
          </div>}

          {!isHumanResources && canReadRates && <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" /> Access & Security
            </h3>
            <details className="group bg-secondary/50 rounded-xl border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-xs font-medium text-muted-foreground">
                Assigned Developments
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-border px-4 py-3 font-semibold">
                {staff?.developments?.length
                  ? staff.developments.join(', ')
                  : "All Access (System Wide)"}
              </div>
            </details>
          </div>}
        </div>

        <div className="p-6 border-t border-border space-y-4" data-testid="section-icon-guide">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Shapes className="w-4 h-4" /> What each icon means
          </h3>
          <p className="text-xs text-muted-foreground">Each feature your company has: what it is, how to get to it and how it opens.</p>
          <div className="space-y-2">
            {FEATURE_GUIDE.filter((f) => f.show(staff, organizationModules)).map((f) => {
              const Icon = f.icon;
              return (
                <details key={f.name} className="group bg-secondary/50 rounded-xl border border-border">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-sm font-semibold">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white border border-border"><Icon className="h-4 w-4" /></span>
                    <span className="flex-1">{f.name}</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <dl className="border-t border-border px-4 py-3 space-y-2 text-sm">
                    <div><dt className="font-semibold">What it is</dt><dd className="text-muted-foreground">{f.what}</dd></div>
                    <div><dt className="font-semibold">How to get there</dt><dd className="text-muted-foreground">{f.where}</dd></div>
                    <div><dt className="font-semibold">How it opens</dt><dd className="text-muted-foreground">{f.opens}</dd></div>
                  </dl>
                </details>
              );
            })}
          </div>
        </div>

        <div className="p-6 border-t border-border space-y-4" data-testid="section-button-guide">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <CircleHelp className="w-4 h-4" /> What the buttons do
          </h3>
          <p className="text-xs text-muted-foreground">A plain-words guide to each page you have and what pressing each button does.</p>
          <div className="space-y-2">
            {BUTTON_GUIDE.filter((g) => hasModuleAccess(staff, g.module, organizationModules)).map((g) => (
              <details key={g.module} className="group bg-secondary/50 rounded-xl border border-border">
                <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-semibold">
                  {g.page}
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border px-4 py-3 space-y-3">
                  <p className="text-sm text-muted-foreground">{g.purpose}</p>
                  <ul className="space-y-2">
                    {g.buttons.map((b) => (
                      <li key={b.name} className="text-sm">
                        <span className="font-semibold">{b.name}</span>
                        <span className="text-muted-foreground"> — {b.does}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </div>

        <div className="p-6 bg-muted/30 border-t border-border flex justify-between items-center">
          <div>
            <h4 className="font-semibold text-sm">Session Management</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Sign out of this device to clear your session.</p>
          </div>
          <Button variant="destructive" onClick={() => logout()} className="gap-2">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
