import { useCallback, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Receipt } from "lucide-react";

// Monthly bills on the website. Every receipt FIAREP purchases, and every
// 30 days one bill per client, building by building, with the total owed.
// FIAREP sees every client's; a client sees its own.
type Item = { projectId: string; quoteId: string; building: string; purchasedAt: string; lines: Array<{ qty: number; label: string; amount: number }>; total: number; paid: boolean; carried: boolean };
type Statement = {
  id: string; clientTenantId: string; clientCompany: string; periodStart: string; periodEnd: string;
  buildings: Array<{ building: string; items: Item[]; spent: number; owed: number }>;
  spent: number; paidBack: number; carried: number; owed: number;
};
type Open = { clientTenantId: string; clientCompany: string; owed: number; receipts: number; billDue: string | null };
type Quote = { id?: string; building: string; clientCompany: string; total: number; lines: Array<{ id: string; qty: number; label: string; amount: number }>; purchasedAt?: string; paidAt?: string; statementId?: string };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();
const get = <T,>(url: string) => customFetch<T>(url, { responseType: "json" } as never);

export default function Bills() {
  const { staff } = useAuth();
  const fiarep = (staff?.tenantId || "default") === "default";
  const [statements, setStatements] = useState<Statement[] | null>(null);
  const [open, setOpen] = useState<Open[]>([]);
  const [receipts, setReceipts] = useState<Quote[]>([]);
  const [shown, setShown] = useState(() => new URLSearchParams(window.location.search).get("id") || "");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      if (fiarep) {
        const r = await get<{ statements: Statement[]; open: Open[] }>("/api/v1/fiarep/statements");
        setStatements(r.statements); setOpen(r.open);
        const q = await get<Array<{ quote: Quote }>>("/api/v1/fiarep/quotes");
        setReceipts(q.map((x) => x.quote).filter((x) => !!x.purchasedAt));
      } else {
        const r = await get<{ statements: Statement[]; open: Open | null }>("/api/v1/owner/statements");
        setStatements(r.statements); setOpen(r.open ? [r.open] : []);
        const q = await get<Array<{ quote: Quote }>>("/api/v1/owner/quotes");
        setReceipts(q.map((x) => x.quote).filter((x) => !!x.purchasedAt));
      }
      setError("");
    } catch (e: any) { setStatements([]); setError(e?.data?.error || "Could not load."); }
  }, [fiarep]);
  useEffect(() => { void load(); }, [load]);

  if (statements === null) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const unbilled = receipts.filter((r) => !r.statementId).sort((a, b) => String(b.purchasedAt).localeCompare(String(a.purchasedAt)));

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><Receipt className="h-5 w-5" />Monthly bills</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {open.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {open.map((o) => (
            <div key={o.clientTenantId} className="rounded-lg border bg-card p-4">
              <p className="font-semibold">{o.clientCompany}</p>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Owed now · {o.receipts} receipt{o.receipts === 1 ? "" : "s"}</span>
                <span className="text-lg font-bold">{money(o.owed)}</span>
              </div>
              {o.billDue && <p className="text-sm text-muted-foreground">Next bill {day(o.billDue)}</p>}
            </div>
          ))}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Receipts this period</h2>
        {unbilled.length === 0 && <p className="text-sm text-muted-foreground">No receipts yet.</p>}
        {unbilled.map((r) => (
          <div key={r.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.building}{fiarep && r.clientCompany ? <span className="text-muted-foreground"> · {r.clientCompany}</span> : null}</p>
              <p className="text-sm text-muted-foreground">{day(r.purchasedAt!)} · {r.lines.map((l) => `${l.qty} × ${l.label}`).join(", ")}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{money(r.total)}</p>
              <p className={`text-xs ${r.paidAt ? "text-emerald-700" : "text-amber-700"}`}>{r.paidAt ? "Paid" : "Owed"}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Bills</h2>
        {statements.length === 0 && <p className="text-sm text-muted-foreground">No bill yet.</p>}
        {statements.map((s) => (
          <div key={s.id} className="rounded-lg border bg-card">
            <button type="button" className="flex w-full items-baseline justify-between gap-3 p-4 text-left" onClick={() => setShown(shown === s.id ? "" : s.id)}>
              <span>
                <span className="block font-semibold">{s.clientCompany}</span>
                <span className="text-sm text-muted-foreground">{day(s.periodStart)} – {day(s.periodEnd)}</span>
              </span>
              <span className={`font-bold ${s.owed > 0 ? "text-amber-700" : "text-emerald-700"}`}>{money(s.owed)} owed</span>
            </button>
            {shown === s.id && (
              <div className="space-y-3 border-t px-4 pb-4 pt-3">
                {s.buildings.map((b) => (
                  <div key={b.building} className="space-y-1">
                    <p className="font-semibold">{b.building}</p>
                    {b.items.map((i) => (
                      <div key={i.quoteId} className="flex items-start gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p>{day(i.purchasedAt)}{i.carried ? " · earlier bill" : ""}</p>
                          <p className="text-muted-foreground">{i.lines.map((l) => `${l.qty} × ${l.label}`).join(", ")}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{money(i.total)}</p>
                          <p className={`text-xs ${i.paid ? "text-emerald-700" : "text-amber-700"}`}>{i.paid ? "Paid" : "Owed"}</p>
                        </div>
                      </div>
                    ))}
                    <p className="text-right text-sm text-muted-foreground">Building owed {money(b.owed)}</p>
                  </div>
                ))}
                <div className="space-y-0.5 border-t pt-2 text-sm">
                  <div className="flex justify-between text-muted-foreground"><span>Spent this period</span><span>{money(s.spent)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>Paid back</span><span>{money(s.paidBack)}</span></div>
                  {s.carried > 0 && <div className="flex justify-between text-muted-foreground"><span>From earlier bills</span><span>{money(s.carried)}</span></div>}
                  <div className="flex justify-between text-base font-bold"><span>Total owed</span><span>{money(s.owed)}</span></div>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
