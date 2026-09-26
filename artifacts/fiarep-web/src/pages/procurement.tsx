import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEntityRecordsQueryKey,
  useCreateEntityRecord,
  useDeleteEntityRecord,
  useListEntityRecords,
  usePerformEntityAction,
  useUpdateEntityRecord,
} from "@workspace/api-client-react";
import { LogOut, ShoppingCart, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

// Procurement's workspace, laid out like the original app's Procurement
// screen: Awaiting release -> Out for bid -> Awarded -> Closed, each scope
// carrying its complaint/violation reference, plus the vendor contact list the
// release email goes to.

type Rec = { id: string; version: number; state?: Record<string, any>; updatedAt?: string };

const fmt = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "";
};
const reference = (s: Record<string, any>) =>
  s.sourceRef || s.complaintNo || (s.violationNo ? `Violation ${s.violationNo}` : "");

function Section({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <button type="button" onClick={onToggle} className="flex items-center gap-2 text-lg font-semibold">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{title}{count >= 0 ? ` (${count})` : ""}
      </button>
      {open && children}
    </section>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-4 border-b py-1 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{children}</span></div>;
}

export default function Procurement() {
  const { logout, staff } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const action = usePerformEntityAction();
  const canAct = staff?.role === "procurement" || staff?.role === "administrator";

  const scopesQuery = useListEntityRecords("procurement", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("procurement"), refetchInterval: 15_000, refetchOnMount: "always" },
  });
  const bidsQuery = useListEntityRecords("procurement-bids", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("procurement-bids"), refetchInterval: 15_000, refetchOnMount: "always" },
  });
  const scopes = (scopesQuery.data || []) as Rec[];
  const bids = (bidsQuery.data || []) as Rec[];

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ pending: true, bidding: true, awarded: true, closed: false, contacts: false });
  const [openScope, setOpenScope] = useState<Record<string, boolean>>({});
  const [openBids, setOpenBids] = useState<Record<string, boolean>>({});
  const [walk, setWalk] = useState<Record<string, string>>({});
  const [walkNote, setWalkNote] = useState<Record<string, string>>({});
  const [closeAt, setCloseAt] = useState<Record<string, string>>({});
  const [returnFor, setReturnFor] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [perf, setPerf] = useState<Record<string, "good" | "fair" | "poor">>({});
  const [charged, setCharged] = useState<Record<string, string>>({});
  const [deduct, setDeduct] = useState<Record<string, string>>({});
  const [deductWhy, setDeductWhy] = useState<Record<string, string>>({});

  const match = (r: Rec) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const s = r.state || {};
    return [s.address, s.trackingId, reference(s), s.vendor].some((v) => String(v || "").toLowerCase().includes(q));
  };
  const byStatus = (status: string) => scopes.filter((r) => String(r.state?.status || "") === status && match(r));
  const pending = byStatus("approved");
  const bidding = byStatus("bidding");
  const awarded = byStatus("awarded");
  const closed = byStatus("closed");

  async function run(r: Rec, name: string, data?: Record<string, unknown>, done?: string) {
    try {
      await action.mutateAsync({ entity: "procurement", id: r.id, action: name, data: data as never });
      await invalidateOperationalQueries(queryClient, "procurement", r.id, ["procurement-bids"]);
      if (done) toast({ title: done });
      return true;
    } catch (error: any) {
      toast({ variant: "destructive", title: "Action failed", description: error?.message || "Please try again." });
      return false;
    }
  }

  function header(r: Rec) {
    const s = r.state || {};
    return (
      <>
        <Line label="ID"><span className="text-primary">{s.trackingId || "Not yet sent"}</span></Line>
        {!!reference(s) && <Line label="Reference">{reference(s)}</Line>}
        <Line label="Address">{s.address || "—"}</Line>
      </>
    );
  }

  function scopeDetails(r: Rec) {
    const s = r.state || {};
    return (
      <div className="space-y-1">
        <Button variant="outline" size="sm" onClick={() => setOpenScope((m) => ({ ...m, [r.id]: !m[r.id] }))}>
          {openScope[r.id] ? "Hide full scope" : "View full scope & quote"}
        </Button>
        {openScope[r.id] && (
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="whitespace-pre-wrap">{s.scope || s.scopeDescription || "No scope description."}</p>
            {!!s.cpmNotes && <p className="whitespace-pre-wrap text-muted-foreground">CPM notes: {s.cpmNotes}</p>}
            {!!s.violationNotes && <p className="whitespace-pre-wrap text-muted-foreground">Violation notes: {s.violationNotes}</p>}
            {!!s.scopeFileName && <p className="text-muted-foreground">File: {s.scopeFileName}</p>}
            <p className="text-muted-foreground">Scoped by {s.cpmName || s.requestedBy || "CPM"}{s.handoffTargetName ? ` · approved by ${s.handoffTargetName}` : ""}</p>
          </div>
        )}
      </div>
    );
  }

  function returnControl(r: Rec) {
    if (!canAct) return null;
    if (returnFor !== r.id) {
      return <button type="button" className="text-sm font-semibold text-red-700" onClick={() => { setReturnFor(r.id); setReturnReason(""); }}>Return for revision</button>;
    }
    return (
      <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
        <Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Why is this scope being sent back? (sent to the CPM and CPM Supervisor)" className="bg-white" />
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" disabled={returnReason.trim().length < 3 || action.isPending}
            onClick={async () => { if (await run(r, "return", { note: returnReason.trim() }, "Returned for revision")) setReturnFor(null); }}>Send back</Button>
          <Button variant="outline" size="sm" onClick={() => setReturnFor(null)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Procurement</h1>
            <p className="text-sm text-muted-foreground">Release approved scopes to vendors, award bids, rate and close.</p>
          </div>
        </div>
        <Button variant="outline" onClick={logout} className="gap-2" data-testid="button-procurement-sign-out"><LogOut className="h-4 w-4" />Sign out</Button>
      </div>

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by address, ID (SR-…), complaint/violation #, or vendor" />

      <Section title="Awaiting release" count={pending.length} open={open.pending} onToggle={() => setOpen((m) => ({ ...m, pending: !m.pending }))}>
        {pending.length === 0 ? <p className="text-sm text-muted-foreground">Nothing pending.</p> : pending.map((r) => {
          const s = r.state || {};
          return (
            <Card key={r.id}><CardContent className="space-y-3 pt-6">
              {header(r)}
              <p className="text-xs text-muted-foreground">Scoped by {s.cpmName || s.requestedBy || "CPM"} {fmt(s.requestedAt)}</p>
              {scopeDetails(r)}
              {canAct && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div><p className="mb-1 text-sm font-medium">Walk-through date &amp; time</p><Input type="datetime-local" value={walk[r.id] || ""} onChange={(e) => setWalk((m) => ({ ...m, [r.id]: e.target.value }))} /></div>
                  <div><p className="mb-1 text-sm font-medium">Bids close</p><Input type="datetime-local" value={closeAt[r.id] || ""} onChange={(e) => setCloseAt((m) => ({ ...m, [r.id]: e.target.value }))} /></div>
                  <div className="sm:col-span-2"><p className="mb-1 text-sm font-medium">Meeting note</p><Textarea value={walkNote[r.id] || ""} onChange={(e) => setWalkNote((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Where to meet, what to bring, etc." /></div>
                </div>
              )}
              {canAct && (
                <Button className="w-full" disabled={action.isPending || !closeAt[r.id]}
                  onClick={() => run(r, "broadcast", {
                    ...(walk[r.id] ? { walkthroughAt: fmt(walk[r.id]) } : {}),
                    ...((walkNote[r.id] || "").trim() ? { walkthroughNote: walkNote[r.id]!.trim() } : {}),
                    bidCloseAt: fmt(closeAt[r.id]),
                  }, "Sent to all vendors")}>
                  Send to all vendors
                </Button>
              )}
              {returnControl(r)}
            </CardContent></Card>
          );
        })}
      </Section>

      <Section title="Out for bid" count={bidding.length} open={open.bidding} onToggle={() => setOpen((m) => ({ ...m, bidding: !m.bidding }))}>
        {bidding.length === 0 ? <p className="text-sm text-muted-foreground">No open bids.</p> : bidding.map((r) => {
          const s = r.state || {};
          const rBids = bids.filter((b) => b.state?.requestId === r.id).sort((a, b) => Number(a.state?.amount || 0) - Number(b.state?.amount || 0));
          const checkIns = Array.isArray(s.walkthroughCheckIns) ? s.walkthroughCheckIns : [];
          return (
            <Card key={r.id}><CardContent className="space-y-3 pt-6">
              {header(r)}
              <p className="text-xs text-muted-foreground">Open since {fmt(s.broadcastAt || s.invitedAt)}{s.walkthroughAt ? ` · walk-through ${s.walkthroughAt}` : ""}{s.bidCloseAt ? ` · bids close ${s.bidCloseAt}` : ""}</p>
              {scopeDetails(r)}
              {checkIns.length > 0 && <p className="text-xs text-muted-foreground">Walk-through check-ins: {checkIns.map((c: any) => c.vendorName).join(", ")}</p>}
              <button type="button" className="text-sm font-semibold text-primary" onClick={() => setOpenBids((m) => ({ ...m, [r.id]: !m[r.id] }))}>
                {openBids[r.id] ? "Hide" : "Show"} bids ({rBids.length})
              </button>
              {openBids[r.id] && (rBids.length === 0 ? <p className="text-sm text-muted-foreground">No bids in yet.</p> : rBids.map((b) => (
                <div key={b.id} className="space-y-2 border-t pt-2">
                  <Line label={String(b.state?.vendorName || "Vendor")}>{money(b.state?.amount)}</Line>
                  {!!b.state?.note && <p className="text-sm text-muted-foreground">{b.state.note}</p>}
                  {canAct && <Button size="sm" disabled={action.isPending}
                    onClick={() => run(r, "award", { vendor: b.state?.vendorName, bidAmount: b.state?.amount, bidNote: b.state?.note, bidId: b.id }, `Awarded to ${b.state?.vendorName}`)}>
                    Award to {String(b.state?.vendorName || "vendor")}
                  </Button>}
                </div>
              )))}
              {returnControl(r)}
            </CardContent></Card>
          );
        })}
      </Section>

      <Section title="Awarded" count={awarded.length} open={open.awarded} onToggle={() => setOpen((m) => ({ ...m, awarded: !m.awarded }))}>
        {awarded.length === 0 ? <p className="text-sm text-muted-foreground">Nothing awarded yet.</p> : awarded.map((r) => {
          const s = r.state || {};
          const amt = Math.max(0, Number(charged[r.id]) || 0);
          const cut = Math.min(amt, Math.max(0, Number(deduct[r.id]) || 0));
          return (
            <Card key={r.id}><CardContent className="space-y-3 pt-6">
              {header(r)}
              <Line label="Vendor">{s.vendor || "—"}{s.bidAmount ? ` · bid ${money(s.bidAmount)}` : ""}</Line>
              <p className="text-xs text-muted-foreground">Awarded {fmt(s.awardAt || s.awardedAt)}{s.vendorStartedAt ? ` · started ${fmt(s.vendorStartedAt)}` : ""}{s.vendorCompletedAt ? ` · completed ${fmt(s.vendorCompletedAt)}` : ""}</p>
              {scopeDetails(r)}
              {canAct && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Work quality</p>
                  <div className="flex gap-2">
                    {(["good", "fair", "poor"] as const).map((lvl) => (
                      <Button key={lvl} type="button" size="sm" variant={perf[r.id] === lvl ? "default" : "outline"} className="flex-1 capitalize" onClick={() => setPerf((m) => ({ ...m, [r.id]: lvl }))}>{lvl}</Button>
                    ))}
                  </div>
                  <Input type="number" min="0" step="0.01" value={charged[r.id] || ""} onChange={(e) => setCharged((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Amount vendor charged ($)" />
                  <Input type="number" min="0" step="0.01" value={deduct[r.id] || ""} onChange={(e) => setDeduct((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Deduction for poor work ($, optional)" />
                  {cut > 0 && <Input value={deductWhy[r.id] || ""} onChange={(e) => setDeductWhy((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Reason for the deduction" />}
                  {amt > 0 && <p className="text-sm">Vendor paid <span className="font-semibold">{money(amt - cut)}</span>{cut > 0 ? ` (cut ${money(cut)})` : ""}</p>}
                  <Button className="w-full" disabled={action.isPending || !perf[r.id] || amt <= 0 || (cut > 0 && !(deductWhy[r.id] || "").trim())}
                    onClick={() => run(r, "rate-close", {
                      performance: perf[r.id],
                      amountCharged: amt,
                      ...(cut > 0 ? { deduction: cut, deductionReason: deductWhy[r.id]!.trim() } : {}),
                      finalAmount: amt - cut,
                      closedAt: new Date().toISOString(),
                    }, `Closed · vendor paid ${money(amt - cut)}`)}>
                    Rate &amp; close out
                  </Button>
                </div>
              )}
            </CardContent></Card>
          );
        })}
      </Section>

      <Section title="Closed / history" count={closed.length} open={open.closed} onToggle={() => setOpen((m) => ({ ...m, closed: !m.closed }))}>
        {closed.length === 0 ? <p className="text-sm text-muted-foreground">Nothing closed yet.</p> : closed.map((r) => {
          const s = r.state || {};
          return (
            <Card key={r.id}><CardContent className="space-y-2 pt-6">
              {header(r)}
              <Line label="Vendor">{s.vendor || "—"}</Line>
              <Line label="Paid">{money(s.finalAmount ?? s.amountCharged)}{s.deduction ? ` (cut ${money(s.deduction)}: ${s.deductionReason || ""})` : ""}</Line>
              <Line label="Work quality"><span className="capitalize">{s.performance || "—"}</span></Line>
              <p className="text-xs text-muted-foreground">Closed {fmt(s.closedAt || s.rate_closeAt)}</p>
              {scopeDetails(r)}
            </CardContent></Card>
          );
        })}
      </Section>

      <Section title="Vendor contacts" count={-1} open={open.contacts} onToggle={() => setOpen((m) => ({ ...m, contacts: !m.contacts }))}>
        <VendorContacts canEdit={canAct} />
      </Section>
    </div>
  );
}

/** The list every release email goes to. */
function VendorContacts({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const contactsQuery = useListEntityRecords("vendor-contacts", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("vendor-contacts"), refetchOnMount: "always" },
  });
  const create = useCreateEntityRecord();
  const update = useUpdateEntityRecord();
  const remove = useDeleteEntityRecord();
  const contacts = useMemo(() => ([...(contactsQuery.data || [])] as Rec[])
    .sort((a, b) => String(a.state?.name || "").localeCompare(String(b.state?.name || ""))), [contactsQuery.data]);
  const [editing, setEditing] = useState<Rec | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("vendor-contacts") });
  const reset = () => { setEditing(null); setName(""); setPhone(""); setEmail(""); };

  async function save() {
    if (!name.trim()) { toast({ variant: "destructive", title: "Name required" }); return; }
    const state = { name: name.trim(), phone: phone.trim(), email: email.trim() };
    try {
      if (editing) await update.mutateAsync({ entity: "vendor-contacts", id: editing.id, data: { id: editing.id, state, version: editing.version } as never });
      else await create.mutateAsync({ entity: "vendor-contacts", data: { id: crypto.randomUUID(), state, version: 1 } as never });
      await refresh();
      toast({ title: editing ? "Contact updated" : "Contact added" });
      reset();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Could not save contact", description: error?.message });
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Every release is emailed to these contacts</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {contacts.length === 0 && <p className="text-sm text-muted-foreground">No vendor contacts yet — releases will reach no one until you add some.</p>}
        {contacts.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
            <div><p className="font-medium">{c.state?.name}</p><p className="text-muted-foreground">{[c.state?.email, c.state?.phone].filter(Boolean).join(" · ") || "No email or phone"}</p></div>
            {canEdit && <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEditing(c); setName(String(c.state?.name || "")); setPhone(String(c.state?.phone || "")); setEmail(String(c.state?.email || "")); }}>Edit</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={async () => {
                try { await remove.mutateAsync({ entity: "vendor-contacts", id: c.id, data: { version: c.version } as never }); await refresh(); }
                catch (error: any) { toast({ variant: "destructive", title: "Could not remove", description: error?.message }); }
              }}>Remove</Button>
            </div>}
          </div>
        ))}
        {canEdit && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor / company name" />
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
            <div className="flex gap-2 sm:col-span-3">
              <Button onClick={save} disabled={create.isPending || update.isPending}>{editing ? "Save contact" : "Add contact"}</Button>
              {editing && <Button variant="outline" onClick={reset}>Cancel</Button>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
