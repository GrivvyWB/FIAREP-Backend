import { ScopeLines, ViolationCode } from "@/components/scope-lines";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEntityRecordsQueryKey,
  getListNotificationsQueryKey,
  useCreateEntityRecord,
  useDeleteEntityRecord,
  useListEntityRecords,
  useListNotifications,
  useMarkNotificationRead,
  usePerformEntityAction,
  useUpdateEntityRecord,
} from "@workspace/api-client-react";
import { Bell, CheckCircle2, ChevronDown, Download, Eye, FileText, Gavel, LogOut, Mail, MapPin, Search, Send, ShoppingCart, Trophy, Undo2, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
// Walk-through / bid-close times in the original app's style:
// "08/31/2026 Monday 10:00 AM".
const fmtSchedule = (value?: string) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const date = d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} ${weekday} ${time}`;
};
const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "";
};
const reference = (s: Record<string, any>) =>
  s.sourceRef || s.complaintNo || (s.violationNo ? `Violation ${s.violationNo}` : "");

const TAB_OF: Record<string, Tab> = { approved: "pending", bidding: "bidding", awarded: "awarded", closed: "closed" };
type Tab = "pending" | "bidding" | "awarded" | "closed" | "contacts";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  approved: { label: "Pending release", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  bidding: { label: "Open", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  awarded: { label: "Awarded", cls: "bg-purple-50 text-purple-700 ring-purple-200" },
  closed: { label: "Closed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

function StatusBadge({ status }: { status: string }) {
  const b = STATUS_BADGE[status] || { label: status || "—", cls: "bg-slate-50 text-slate-700 ring-slate-200" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${b.cls}`}>{b.label}</span>;
}

const shortDate = (value?: string) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
};

/** Latest thing that happened to a release, for the activity table. */
const lastActivity = (r: Rec) => {
  const s = r.state || {};
  return String(s.closedAt || s.rate_closeAt || s.vendorCompletedAt || s.vendorStartedAt || s.awardAt || s.awardedAt ||
    s.broadcastAt || s.invitedAt || s.approveAt || s.approvedAt || s.reviewAt || r.updatedAt || s.requestedAt || "");
};

/** Type of work: the CPM's CSI section names, else the trade / title. */
const workType = (s: Record<string, any>) => {
  const sections: string[] = [];
  for (const d of s.cpmScope?.divisions || []) for (const sec of d.sections || []) {
    if (sec?.code) sections.push(String(sec.code).replace(/^Section\s+[\d\s.]+\s*[-–—]\s*/i, "").trim());
  }
  if (sections.length) return sections.length > 1 ? `${sections[0]} +${sections.length - 1}` : sections[0];
  return String(s.trade || s.workType || s.category || s.title || "General repairs");
};

/** What happened when the release email went out. */
function DeliveryNote({ state }: { state: Record<string, any> }) {
  const d = state.vendorEmail;
  if (!d) return null;
  const when = fmt(d.at);
  if (d.error || (d.recipients > 0 && d.sent === 0)) {
    return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Email to vendors did not go out ({d.error || `${d.failed} failed`}) · {when}. Give vendors the code {state.trackingId} directly, or check the Outlook connection in Replit.</p>;
  }
  if (!d.recipients) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No vendor had an email address, so nobody was emailed · {when}. Add vendors under Vendor contacts, then use Send to more vendors.</p>;
  }
  return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Emailed {d.sent} of {d.recipients} vendor{d.recipients === 1 ? "" : "s"}{d.failed ? ` · ${d.failed} failed` : ""} · {when}</p>;
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0"><span className="text-slate-500">{label}</span><span className="text-right font-medium text-slate-900">{children}</span></div>;
}

function StatCard({ icon, tone, label, value, sub, active, onClick }: { icon: ReactNode; tone: string; label: string; value: number; sub: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex flex-col items-start gap-3 rounded-xl border bg-white p-4 text-left sm:flex-row sm:gap-4 sm:p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200"}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white shadow-sm ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-600">{label}</span>
        <span className="mt-1 block text-3xl font-bold tracking-tight text-slate-900">{value}</span>
        <span className="mt-1 block text-xs text-slate-500">{sub}</span>
      </span>
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-blue-50 text-blue-600"><FileText className="h-7 w-7" /></span>
      <p className="mt-4 text-lg font-semibold text-slate-900">No items found</p>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}

/** Bell with the procurement inbox; procurement can't reach /notifications. */
function NotificationBell({ onOpenRecord }: { onOpenRecord: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), refetchInterval: 30_000, refetchOnMount: "always" },
  });
  const markRead = useMarkNotificationRead();
  const items = [...(data || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30);
  const unread = items.filter((n) => !n.read);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
          className="relative grid h-10 w-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
          <Bell className="h-5 w-5" />
          {unread.length > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread.length > 0 && (
            <button type="button" className="text-xs font-semibold text-blue-600 hover:underline"
              onClick={async () => { await Promise.all(unread.map((n) => markRead.mutateAsync({ id: n.id }).catch(() => undefined))); await refresh(); }}>
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</p> : items.map((n) => (
            <button key={n.id} type="button"
              className={`block w-full border-b px-4 py-3 text-left text-sm last:border-0 hover:bg-slate-50 ${n.read ? "text-slate-600" : "bg-blue-50/40 font-medium text-slate-900"}`}
              onClick={async () => {
                if (!n.read) { await markRead.mutateAsync({ id: n.id }).catch(() => undefined); await refresh(); }
                if (n.reportId) onOpenRecord(n.reportId);
              }}>
              <span className="block">{n.message}</span>
              {!!n.detail && <span className="mt-0.5 block text-xs text-slate-500">{n.detail}</span>}
              <span className="mt-1 block text-[11px] text-slate-400">{fmt(n.at)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ROLE_LABEL: Record<string, string> = { procurement: "Procurement", administrator: "Administrator" };

export default function Procurement() {
  const { logout, staff } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const action = usePerformEntityAction();
  // Only Procurement may act; the server enforces the same rule.
  const canAct = staff?.role === "procurement";

  const scopesQuery = useListEntityRecords("procurement", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("procurement"), refetchInterval: 15_000, refetchOnMount: "always" },
  });
  const bidsQuery = useListEntityRecords("procurement-bids", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("procurement-bids"), refetchInterval: 15_000, refetchOnMount: "always" },
  });
  const scopes = (scopesQuery.data || []) as Rec[];
  const bids = (bidsQuery.data || []) as Rec[];

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("pending");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<Record<string, boolean>>({});
  const [showAllActivity, setShowAllActivity] = useState(false);
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
  const [extraTo, setExtraTo] = useState<Record<string, string>>({});
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({});
  const [moreTo, setMoreTo] = useState<Record<string, string>>({});
  const activityRef = useRef<HTMLDivElement>(null);
  const contactsQuery = useListEntityRecords("vendor-contacts", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("vendor-contacts"), refetchOnMount: "always" },
  });
  const vendorEmails = ((contactsQuery.data || []) as Rec[]).filter((c) => String(c.state?.email || "").includes("@")).length;

  const match = (r: Rec) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const s = r.state || {};
    return [s.address, s.trackingId, reference(s), s.vendor, s.violationCode, workType(s)]
      .some((v) => String(v || "").toLowerCase().includes(q));
  };
  const released = scopes.filter((r) => TAB_OF[String(r.state?.status || "")]);
  const visible = released.filter(match);
  const byStatus = (status: string) => visible.filter((r) => String(r.state?.status || "") === status);
  const pending = byStatus("approved");
  const bidding = byStatus("bidding");
  const awarded = byStatus("awarded");
  const closed = byStatus("closed");
  const bidsFor = (id: string) => bids.filter((b) => b.state?.requestId === id)
    .sort((a, b) => Number(a.state?.amount || 0) - Number(b.state?.amount || 0));
  const activity = [...visible].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));

  // Jump to a release: its tab, its details open, scrolled into view.
  function openRecord(id: string) {
    const r = scopes.find((x) => x.id === id);
    const t = r ? TAB_OF[String(r.state?.status || "")] : undefined;
    if (!r || !t) { toast({ title: "That item is no longer in Procurement" }); return; }
    setQuery("");
    setTab(t);
    setOpenScope((m) => ({ ...m, [id]: true }));
    if (t === "bidding") setOpenBids((m) => ({ ...m, [id]: true }));
    setFocusId(id);
  }
  useEffect(() => {
    if (!focusId) return;
    const t = window.setTimeout(() => {
      document.getElementById(`release-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    const clear = window.setTimeout(() => setFocusId(null), 2500);
    return () => { window.clearTimeout(t); window.clearTimeout(clear); };
  }, [focusId, tab]);

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

  function card(r: Rec, children: ReactNode) {
    const s = r.state || {};
    return (
      <div key={r.id} id={`release-${r.id}`}
        className={`scroll-mt-6 rounded-xl border bg-white p-5 shadow-sm transition ${focusId === r.id ? "border-blue-400 ring-2 ring-blue-200" : "border-slate-200"}`}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-base font-semibold text-slate-900"><MapPin className="h-4 w-4 shrink-0 text-slate-400" />{s.address || "No address"}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {workType(s)}{reference(s) ? ` · ${reference(s)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!!s.trackingId && <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">{s.trackingId}</span>}
            <StatusBadge status={String(s.status || "")} />
          </div>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    );
  }

  function scopeDetails(r: Rec) {
    const s = r.state || {};
    return (
      <div className="space-y-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpenScope((m) => ({ ...m, [r.id]: !m[r.id] }))}>
          <Eye className="h-4 w-4" />{openScope[r.id] ? "Hide full scope" : "View full scope & quote"}
        </Button>
        {openScope[r.id] && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <ViolationCode state={s} />
            <p className="whitespace-pre-wrap">{s.scope || s.scopeDescription || "No scope description."}</p>
            <ScopeLines scope={s.cpmScope} showPrices />
            {!!s.cpmNotes && <p className="whitespace-pre-wrap text-slate-500">CPM notes: {s.cpmNotes}</p>}
            {!!s.violationNotes && <p className="whitespace-pre-wrap text-slate-500">Violation notes: {s.violationNotes}</p>}
            {!!s.scopeFileName && <p className="text-slate-500">File: {s.scopeFileName}</p>}
            <p className="text-slate-500">Scoped by {s.cpmName || s.requestedBy || "CPM"}{s.handoffTargetName ? ` · approved by ${s.handoffTargetName}` : ""}</p>
          </div>
        )}
      </div>
    );
  }

  function returnControl(r: Rec) {
    if (!canAct) return null;
    if (returnFor !== r.id) {
      return <Button variant="outline" size="sm" className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => { setReturnFor(r.id); setReturnReason(""); }}><Undo2 className="h-4 w-4" />Return for revision</Button>;
    }
    return (
      <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
        <Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Why is this scope being sent back? (sent to the CPM and CPM Supervisor)" className="bg-white" />
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" disabled={returnReason.trim().length < 3 || action.isPending}
            onClick={async () => { if (await run(r, "return", { note: returnReason.trim() }, "Returned for revision")) setReturnFor(null); }}>Send back</Button>
          <Button variant="outline" size="sm" onClick={() => setReturnFor(null)}>Cancel</Button>
        </div>
      </div>
    );
  }

  const pendingCards = pending.map((r) => {
    const s = r.state || {};
    return card(r, <>
      <p className="text-xs text-slate-500">Scoped by {s.cpmName || s.requestedBy || "CPM"}{s.requestedAt ? ` · ${fmt(s.requestedAt)}` : ""}</p>
      {scopeDetails(r)}
      {canAct && (
        <div className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
          <div><p className="mb-1 text-sm font-medium">Walk-through date &amp; time</p><Input type="datetime-local" value={walk[r.id] || ""} onChange={(e) => setWalk((m) => ({ ...m, [r.id]: e.target.value }))} /></div>
          <div><p className="mb-1 text-sm font-medium">Bids close <span className="text-red-600">*</span></p><Input type="datetime-local" value={closeAt[r.id] || ""} onChange={(e) => setCloseAt((m) => ({ ...m, [r.id]: e.target.value }))} /></div>
          <div className="sm:col-span-2"><p className="mb-1 text-sm font-medium">Meeting note</p><Textarea value={walkNote[r.id] || ""} onChange={(e) => setWalkNote((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Where to meet, what to bring, etc." /></div>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Also send to <span className="font-normal text-slate-500">(optional — emails not on your vendor list)</span></p>
            <Textarea rows={2} value={extraTo[r.id] || ""} onChange={(e) => setExtraTo((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="bids@company.com, office@another.com" />
          </div>
          <p className={`flex items-center gap-1.5 text-sm sm:col-span-2 ${vendorEmails + parseEmailList(extraTo[r.id] || "").length ? "text-slate-600" : "text-amber-700"}`}>
            <Mail className="h-4 w-4" />
            {vendorEmails + parseEmailList(extraTo[r.id] || "").length
              ? `Will email ${vendorEmails} vendor contact${vendorEmails === 1 ? "" : "s"}${parseEmailList(extraTo[r.id] || "").length ? ` + ${parseEmailList(extraTo[r.id] || "").length} more` : ""}.`
              : "No vendor emails yet — add them under Vendor contacts or type them above."}
            <button type="button" className="font-semibold text-blue-600 hover:underline" onClick={() => setTab("contacts")}>Manage vendors</button>
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canAct && (
          <Button className="gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={action.isPending || !closeAt[r.id]}
            title={!closeAt[r.id] ? "Set when bids close first" : undefined}
            onClick={() => run(r, "broadcast", {
              ...(walk[r.id] ? { walkthroughAt: fmtSchedule(walk[r.id]), walkthroughAtIso: new Date(walk[r.id]!).toISOString() } : {}),
              ...((walkNote[r.id] || "").trim() ? { walkthroughNote: walkNote[r.id]!.trim() } : {}),
              bidCloseAt: fmtSchedule(closeAt[r.id]),
              bidCloseAtIso: new Date(closeAt[r.id]!).toISOString(),
              vendorRecipients: parseEmailList(extraTo[r.id] || ""),
            }, "Sent to vendors")}>
            <Send className="h-4 w-4" />Send to all vendors
          </Button>
        )}
        {returnControl(r)}
      </div>
    </>);
  });

  const biddingCards = bidding.map((r) => {
    const s = r.state || {};
    const rBids = bidsFor(r.id);
    return card(r, <>
      <p className="text-xs text-slate-500">Open since {fmt(s.broadcastAt || s.invitedAt)}{s.bidCloseAt ? ` · bids close ${s.bidCloseAt}` : ""}</p>
      <DeliveryNote state={s} />
      {scopeDetails(r)}
      <WalkthroughArrivals scope={r} />
      <div className="rounded-lg border border-slate-200">
        <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-slate-900" onClick={() => setOpenBids((m) => ({ ...m, [r.id]: !m[r.id] }))}>
          <span>Bids ({rBids.length}){rBids.length ? ` · lowest ${money(rBids[0]!.state?.amount)}` : ""}</span>
          <ChevronDown className={`h-4 w-4 transition ${openBids[r.id] ? "rotate-180" : ""}`} />
        </button>
        {openBids[r.id] && (
          <div className="border-t border-slate-200 px-4 pb-3">
            {rBids.length === 0 ? <p className="py-3 text-sm text-slate-500">No bids in yet.</p> : rBids.map((b, i) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{String(b.state?.vendorName || "Vendor")}{i === 0 && rBids.length > 1 ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Lowest</span> : null}</p>
                  {!!b.state?.note && <p className="text-sm text-slate-500">{b.state.note}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-slate-900">{money(b.state?.amount)}</span>
                  {canAct && <Button size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={action.isPending}
                    onClick={() => run(r, "award", { vendor: b.state?.vendorName, bidAmount: b.state?.amount, bidNote: b.state?.note, bidId: b.id }, `Awarded to ${b.state?.vendorName}`)}>
                    <Trophy className="h-4 w-4" />Award
                  </Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {canAct && (moreOpen[r.id] ? (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <p className="text-sm font-medium text-slate-900">Send {s.trackingId} to more vendors</p>
          <Textarea rows={3} className="bg-white" value={moreTo[r.id] || ""} onChange={(e) => setMoreTo((m) => ({ ...m, [r.id]: e.target.value }))}
            placeholder={"Type or paste emails (one per line or comma separated).\nLeave empty to resend to every vendor contact."} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700"
              disabled={action.isPending || (!parseEmailList(moreTo[r.id] || "").length && vendorEmails === 0)}
              onClick={async () => {
                const list = parseEmailList(moreTo[r.id] || "");
                if (await run(r, "resend", { vendorRecipients: list }, list.length ? `Sent to ${list.length} more vendor${list.length === 1 ? "" : "s"}` : `Resent to ${vendorEmails} vendor${vendorEmails === 1 ? "" : "s"}`)) {
                  setMoreOpen((m) => ({ ...m, [r.id]: false })); setMoreTo((m) => ({ ...m, [r.id]: "" }));
                }
              }}>
              <Send className="h-4 w-4" />
              {parseEmailList(moreTo[r.id] || "").length ? `Send to ${parseEmailList(moreTo[r.id] || "").length}` : `Resend to all ${vendorEmails}`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMoreOpen((m) => ({ ...m, [r.id]: false }))}>Cancel</Button>
          </div>
        </div>
      ) : null)}
      <div className="flex flex-wrap gap-2">
        {canAct && !moreOpen[r.id] && <Button variant="outline" size="sm" className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => setMoreOpen((m) => ({ ...m, [r.id]: true }))}><Send className="h-4 w-4" />Send to more vendors</Button>}
        {returnControl(r)}
      </div>
    </>);
  });

  const awardedCards = awarded.map((r) => {
    const s = r.state || {};
    const amt = Math.max(0, Number(charged[r.id]) || 0);
    const cut = Math.min(amt, Math.max(0, Number(deduct[r.id]) || 0));
    return card(r, <>
      <div className="rounded-lg border border-slate-200 px-4 py-2">
        <Line label="Vendor">{s.vendor || "—"}</Line>
        <Line label="Winning bid">{money(s.bidAmount) || "—"}</Line>
        <Line label="Awarded">{fmt(s.awardAt || s.awardedAt) || "—"}</Line>
        <Line label="Vendor started">{s.startedAt || s.vendorStartedAt ? fmt(s.startedAt || s.vendorStartedAt) : "Not yet"}</Line>
        <Line label="Vendor completed">{s.completedAt || s.vendorCompletedAt ? fmt(s.completedAt || s.vendorCompletedAt) : "Not yet"}</Line>
      </div>
      <WalkthroughArrivals scope={r} />
      {scopeDetails(r)}
      {canAct && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-900">Rate &amp; close out</p>
          <div className="flex gap-2">
            {(["good", "fair", "poor"] as const).map((lvl) => (
              <Button key={lvl} type="button" size="sm" variant={perf[r.id] === lvl ? "default" : "outline"}
                className={`flex-1 capitalize ${perf[r.id] === lvl ? "bg-blue-600 hover:bg-blue-700" : ""}`} onClick={() => setPerf((m) => ({ ...m, [r.id]: lvl }))}>{lvl}</Button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="number" min="0" step="0.01" value={charged[r.id] || ""} onChange={(e) => setCharged((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Amount vendor charged ($)" />
            <Input type="number" min="0" step="0.01" value={deduct[r.id] || ""} onChange={(e) => setDeduct((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Deduction for poor work ($, optional)" />
          </div>
          {cut > 0 && <Input value={deductWhy[r.id] || ""} onChange={(e) => setDeductWhy((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Reason for the deduction" />}
          {amt > 0 && <p className="text-sm">Vendor paid <span className="font-semibold">{money(amt - cut)}</span>{cut > 0 ? ` (cut ${money(cut)})` : ""}</p>}
          <Button className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={action.isPending || !perf[r.id] || amt <= 0 || (cut > 0 && !(deductWhy[r.id] || "").trim())}
            onClick={() => run(r, "rate-close", {
              performance: perf[r.id],
              amountCharged: amt,
              ...(cut > 0 ? { deduction: cut, deductionReason: deductWhy[r.id]!.trim() } : {}),
              finalAmount: amt - cut,
              closedAt: new Date().toISOString(),
            }, `Closed · vendor paid ${money(amt - cut)}`)}>
            <CheckCircle2 className="h-4 w-4" />Rate &amp; close out
          </Button>
        </div>
      )}
    </>);
  });

  const closedCards = closed.map((r) => {
    const s = r.state || {};
    return card(r, <>
      <div className="rounded-lg border border-slate-200 px-4 py-2">
        <Line label="Vendor">{s.vendor || "—"}</Line>
        <Line label="Paid">{money(s.finalAmount ?? s.amountCharged) || "—"}{s.deduction ? ` (cut ${money(s.deduction)}: ${s.deductionReason || ""})` : ""}</Line>
        <Line label="Work quality"><span className="capitalize">{s.performance || "—"}</span></Line>
        <Line label="Closed">{fmt(s.closedAt || s.rate_closeAt) || "—"}</Line>
      </div>
      {scopeDetails(r)}
    </>);
  });

  const tabs: Array<{ key: Tab; label: string; count?: number; cards?: ReactNode[]; empty?: string }> = [
    { key: "pending", label: "Awaiting release", count: pending.length, cards: pendingCards, empty: "There are no procurement releases awaiting action at this time." },
    { key: "bidding", label: "Out for bid", count: bidding.length, cards: biddingCards, empty: "No scopes are out for bid right now." },
    { key: "awarded", label: "Awarded", count: awarded.length, cards: awardedCards, empty: "Nothing has been awarded yet." },
    { key: "closed", label: "Closed / history", count: closed.length, cards: closedCards, empty: "Nothing has been closed yet." },
    { key: "contacts", label: "Vendor contacts" },
  ];
  const current = tabs.find((t) => t.key === tab)!;
  const loading = scopesQuery.isLoading;
  const rows = showAllActivity ? activity : activity.slice(0, 8);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <div className="flex items-center justify-end gap-3">
          <NotificationBell onOpenRecord={openRecord} />
          <div className="flex items-center gap-3 rounded-full py-1 pl-1 pr-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-bold text-white">
              {(staff?.name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-slate-900">{staff?.name}</span>
              <span className="block text-xs text-slate-500">{ROLE_LABEL[staff?.role || ""] || staff?.position || ""}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <ShoppingCart className="mt-1 h-10 w-10 text-blue-600" strokeWidth={2.2} />
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">Procurement</h1>
              <p className="mt-1 text-slate-500">Release approved scopes to vendors, award bids, rate and close.</p>
            </div>
          </div>
          <Button onClick={logout} className="gap-2 self-start bg-blue-600 px-5 hover:bg-blue-700" data-testid="button-procurement-sign-out"><LogOut className="h-4 w-4" />Sign out</Button>
        </div>

        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm md:p-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} className="h-12 rounded-xl border-slate-200 bg-white pl-10"
              placeholder="Filter by address, ID (SR-…), complaint/violation #, or vendor" />
            {!!query && <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500 hover:text-slate-900">Clear</button>}
          </div>

          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <StatCard icon={<FileText className="h-6 w-6" />} tone="bg-blue-600" label="Total Releases" value={visible.length} sub="Active procurement releases"
              onClick={() => activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <StatCard icon={<Gavel className="h-6 w-6" />} tone="bg-emerald-500" label="Open Bids" value={bidding.length} sub="Awaiting vendor bids" active={tab === "bidding"} onClick={() => setTab("bidding")} />
            <StatCard icon={<Trophy className="h-6 w-6" />} tone="bg-purple-600" label="Awarded" value={awarded.length} sub="Bids awarded" active={tab === "awarded"} onClick={() => setTab("awarded")} />
            <StatCard icon={<CheckCircle2 className="h-6 w-6" />} tone="bg-amber-500" label="Closed" value={closed.length} sub="Completed & closed" active={tab === "closed"} onClick={() => setTab("closed")} />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/60 px-2" role="tablist">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                  className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3.5 text-sm font-semibold transition ${tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
                  {t.label}{typeof t.count === "number" ? ` (${t.count})` : ""}
                </button>
              ))}
            </div>
            <div className="p-4 md:p-5">
              {tab === "contacts" ? <VendorContacts canEdit={canAct} />
                : loading ? <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
                : (current.cards?.length ? <div className="space-y-4">{current.cards}</div> : <EmptyState text={query ? "Nothing matches your filter." : current.empty || ""} />)}
            </div>
          </div>

          <div ref={activityRef} className="scroll-mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Recent Procurement Activity</h2>
              {activity.length > 8 && (
                <button type="button" className="text-sm font-semibold text-blue-600 hover:underline" onClick={() => setShowAllActivity((v) => !v)}>
                  {showAllActivity ? "Show recent" : `Show all (${activity.length})`}
                </button>
              )}
            </div>
            {activity.length === 0 ? <EmptyState text={query ? "Nothing matches your filter." : "Released scopes will appear here."} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Date</th>
                      <th className="px-5 py-3 font-semibold">Address / Location</th>
                      <th className="px-5 py-3 font-semibold">Type</th>
                      <th className="px-5 py-3 font-semibold">Vendor</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const s = r.state || {};
                      const rBids = bidsFor(r.id);
                      const vendor = s.vendor || (s.status === "bidding" ? (rBids.length ? `${rBids.length} bid${rBids.length === 1 ? "" : "s"}` : "Awaiting bids") : "—");
                      const open = !!expandedRow[r.id];
                      return (
                        <Fragment key={r.id}>
                          <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                            <td className="whitespace-nowrap px-5 py-3.5 text-slate-700">{shortDate(lastActivity(r))}</td>
                            <td className="px-5 py-3.5 text-slate-900">{s.address || "—"}</td>
                            <td className="px-5 py-3.5 text-slate-700">{workType(s)}</td>
                            <td className="px-5 py-3.5 text-slate-700">{vendor}</td>
                            <td className="px-5 py-3.5"><StatusBadge status={String(s.status || "")} /></td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" className="h-8 border-blue-300 px-4 text-blue-700 hover:bg-blue-50 hover:text-blue-800" onClick={() => openRecord(r.id)}>View</Button>
                                <button type="button" aria-label={open ? "Hide details" : "Show details"} aria-expanded={open}
                                  className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                  onClick={() => setExpandedRow((m) => ({ ...m, [r.id]: !m[r.id] }))}>
                                  <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={6} className="px-5 pb-4 pt-1">
                                <div className="grid gap-x-8 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:grid-cols-2">
                                  <Line label="ID">{s.trackingId || "Not yet sent"}</Line>
                                  <Line label="Reference">{reference(s) || "—"}</Line>
                                  <Line label="Violation code">{s.violationCode ? `${s.violationCode}${s.hazardClass ? ` · Class ${s.hazardClass}` : ""}` : "—"}</Line>
                                  <Line label="CPM estimate">{money(s.cpmScopeTotal) || "—"}</Line>
                                  <Line label="Walk-through">{s.walkthroughAt || "—"}</Line>
                                  <Line label="Bids close">{s.bidCloseAt || "—"}</Line>
                                  <Line label="Bids received">{rBids.length}{rBids.length ? ` · lowest ${money(rBids[0]!.state?.amount)}` : ""}</Line>
                                  <Line label={s.status === "closed" ? "Paid" : "Winning bid"}>{s.status === "closed" ? money(s.finalAmount ?? s.amountCharged) || "—" : money(s.bidAmount) || "—"}</Line>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Who checked in at the walk-through, when, and whether they were at the building. */
function WalkthroughArrivals({ scope }: { scope: Rec }) {
  const s = scope.state || {};
  const checkIns = (Array.isArray(s.walkthroughCheckIns) ? s.walkthroughCheckIns : []) as any[];
  if (!s.walkthroughAt && checkIns.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm"><span className="font-semibold">Walk-through:</span> {s.walkthroughAt || "not scheduled"}</p>
      {!!s.walkthroughNote && <p className="text-sm text-muted-foreground">{s.walkthroughNote}</p>}
      {checkIns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No vendor has checked in yet.</p>
      ) : checkIns.map((c) => {
        const onSite = c.onSite === true ? "At the building" : c.onSite === false ? "NOT at the building" : "Location recorded";
        const tone = c.onSite === true ? "bg-green-100 text-green-800" : c.onSite === false ? "bg-red-100 text-red-800" : "bg-muted text-foreground";
        const timing = typeof c.minutesFromSchedule === "number"
          ? (c.minutesFromSchedule > 5 ? `${c.minutesFromSchedule} min late` : c.minutesFromSchedule < -5 ? `${Math.abs(c.minutesFromSchedule)} min early` : "on time")
          : "";
        return (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
            <div>
              <p className="font-medium">{c.vendorName}</p>
              <p className="text-muted-foreground">
                Arrived {fmtSchedule(c.capturedAt)}{timing ? ` · ${timing}` : ""}
                {typeof c.distanceMeters === "number" ? ` · ${c.distanceMeters} m from the building` : ""}
                {typeof c.accuracy === "number" ? ` (GPS ±${Math.round(c.accuracy)} m)` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{onSite}</span>
              <a className="text-xs font-semibold text-primary underline" target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}>Map</a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "Name <email>", "email", comma / semicolon / newline separated. */
function parseEmailList(text: string): Array<{ name: string; email: string }> {
  const out = new Map<string, { name: string; email: string }>();
  for (const raw of text.split(/[\n,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const angled = token.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>$/);
    const email = (angled ? angled[2]! : token).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    const name = angled ? angled[1]!.trim().replace(/^"|"$/g, "") : "";
    out.set(email, { name, email });
  }
  return [...out.values()];
}

/** Minimal CSV reader (quotes, commas, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

type ContactInput = { name: string; email: string; phone: string };

/** Reads name / email / phone columns; a header row is optional. */
function contactsFromCsv(text: string): ContactInput[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const hasHeader = head.some((h) => /mail|name|company|vendor|phone/.test(h));
  const col = (re: RegExp, fallback: number) => {
    const i = head.findIndex((h) => re.test(h));
    return hasHeader ? i : fallback;
  };
  const emailCol = col(/mail/, 1);
  const nameCol = col(/company|vendor|name/, 0);
  const phoneCol = col(/phone|tel|mobile|cell/, 2);
  const out = new Map<string, ContactInput>();
  for (const r of hasHeader ? rows.slice(1) : rows) {
    let email = emailCol >= 0 ? String(r[emailCol] || "").trim().toLowerCase() : "";
    if (!email.includes("@")) email = (r.find((c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.trim())) || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    out.set(email, {
      email,
      name: (nameCol >= 0 ? String(r[nameCol] || "") : "").trim() || email.split("@")[1]!.split(".")[0]!,
      phone: (phoneCol >= 0 ? String(r[phoneCol] || "") : "").trim(),
    });
  }
  return [...out.values()];
}

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** The list every release email goes to: add one, paste many, or import a CSV. */
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
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("vendor-contacts") });
  const reset = () => { setEditing(null); setName(""); setPhone(""); setEmail(""); };
  const withEmail = contacts.filter((c) => String(c.state?.email || "").includes("@")).length;

  async function save() {
    if (!name.trim()) { toast({ variant: "destructive", title: "Company name required" }); return; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast({ variant: "destructive", title: "That email doesn't look right" }); return; }
    const state = { name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase() };
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

  // Adds many at once, skipping emails already on the list.
  async function addMany(items: ContactInput[], label: string) {
    const existing = new Set(contacts.map((c) => String(c.state?.email || "").toLowerCase()).filter(Boolean));
    const fresh = items.filter((i) => !existing.has(i.email));
    if (!fresh.length) { toast({ title: items.length ? "Everyone is already on the list" : "No valid email addresses found" }); return 0; }
    setBusy(label);
    let added = 0;
    let failed = 0;
    for (const item of fresh) {
      try {
        await create.mutateAsync({ entity: "vendor-contacts", data: { id: crypto.randomUUID(), state: item, version: 1 } as never });
        added += 1;
      } catch { failed += 1; }
    }
    await refresh();
    setBusy("");
    toast({
      variant: failed ? "destructive" : undefined,
      title: `Added ${added} vendor${added === 1 ? "" : "s"}`,
      description: [items.length - fresh.length ? `${items.length - fresh.length} already on the list` : "", failed ? `${failed} could not be saved` : ""].filter(Boolean).join(" · ") || undefined,
    });
    return added;
  }

  async function importFile(file: File) {
    const text = await file.text();
    const items = contactsFromCsv(text);
    if (!items.length) { toast({ variant: "destructive", title: "No email addresses found in that file", description: "Use the template: Company name, Email, Phone." }); return; }
    await addMany(items, "import");
  }

  const shown = contacts.filter((c) => {
    const q = filter.trim().toLowerCase();
    return !q || [c.state?.name, c.state?.email, c.state?.phone].some((v) => String(v || "").toLowerCase().includes(q));
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><Mail className="h-5 w-5" /></span>
          <div>
            <p className="font-semibold text-slate-900">{withEmail} vendor{withEmail === 1 ? "" : "s"} will get every release by email</p>
            <p className="text-sm text-slate-600">Each email carries the SR- code, address, violation code, type of work and walk-through time.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 bg-white"
            onClick={() => downloadText("vendor-contacts-template.csv", "Company name,Email,Phone\nAcme Plumbing,bids@acmeplumbing.com,212-555-0100\n")}>
            <Download className="h-4 w-4" />CSV template
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 bg-white" disabled={!contacts.length}
            onClick={() => downloadText("vendor-contacts.csv", ["Company name,Email,Phone", ...contacts.map((c) => [c.state?.name, c.state?.email, c.state?.phone].map(csvCell).join(","))].join("\n") + "\n")}>
            <Download className="h-4 w-4" />Export list
          </Button>
          {canEdit && <>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
            <Button size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" />{busy === "import" ? "Importing…" : "Import CSV"}
            </Button>
          </>}
        </div>
      </div>

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-900">{editing ? "Edit vendor" : "Add a vendor"}</p>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
            <div className="flex gap-2">
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={save} disabled={create.isPending || update.isPending}>{editing ? "Save changes" : "Add vendor"}</Button>
              {editing && <Button variant="outline" onClick={reset}>Cancel</Button>}
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-900">Add many at once</p>
            <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5}
              placeholder={"Paste emails — one per line or separated by commas\nbids@acme.com\nMetro Roofing <office@metroroofing.com>"} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">{parseEmailList(bulk).length} valid email{parseEmailList(bulk).length === 1 ? "" : "s"}</span>
              <Button className="bg-blue-600 hover:bg-blue-700" disabled={!!busy || parseEmailList(bulk).length === 0}
                onClick={async () => {
                  const items = parseEmailList(bulk).map((i) => ({ email: i.email, name: i.name || i.email.split("@")[1]!.split(".")[0]!, phone: "" }));
                  if (await addMany(items, "bulk")) setBulk("");
                }}>
                {busy === "bulk" ? "Adding…" : "Add all"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <p className="text-sm font-semibold text-slate-900">Vendor list ({contacts.length})</p>
          {contacts.length > 5 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search vendors" className="h-8 w-48 bg-white" />}
        </div>
        {contacts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No vendor contacts yet — releases will reach no one until you add some.</p>
        ) : shown.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{c.state?.name}</p>
              <p className={String(c.state?.email || "").includes("@") ? "text-slate-500" : "text-amber-700"}>
                {[c.state?.email, c.state?.phone].filter(Boolean).join(" · ") || "No email — won't receive releases"}
              </p>
            </div>
            {canEdit && <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEditing(c); setName(String(c.state?.name || "")); setPhone(String(c.state?.phone || "")); setEmail(String(c.state?.email || "")); }}>Edit</Button>
              <Button size="sm" variant="outline" className="text-red-700 hover:bg-red-50" onClick={async () => {
                try { await remove.mutateAsync({ entity: "vendor-contacts", id: c.id, data: { version: c.version } as never }); await refresh(); toast({ title: "Vendor removed" }); }
                catch (error: any) { toast({ variant: "destructive", title: "Could not remove", description: error?.message }); }
              }}>Remove</Button>
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}
