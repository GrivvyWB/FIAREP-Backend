import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Procurement's two decision screens, matching the original app:
//  - Release to vendors: walk-through date/time + note, bid-close date.
//  - Rate & close: performance, amount charged, deduction + reason.

type Scope = { id: string; state?: Record<string, unknown> };

function reference(scope: Scope | null) {
  const s = scope?.state || {};
  return [s.sourceRef || s.complaintNo || s.violationNo, s.address].filter(Boolean).join(" · ");
}

export function ReleaseToVendorsDialog({ scope, onClose, onSubmit, pending }: {
  scope: Scope | null;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [walkthroughAt, setWalkthroughAt] = useState("");
  const [walkthroughNote, setWalkthroughNote] = useState("");
  const [bidCloseAt, setBidCloseAt] = useState("");
  const fmt = (value: string) => (value ? new Date(value).toLocaleString() : "");
  return (
    <Dialog open={!!scope} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Approve &amp; send to vendors</DialogTitle>
          <DialogDescription>{reference(scope) || "Scope"} — every vendor contact is emailed a code to view it and bid.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium">Walk-through date &amp; time</p>
            <Input type="datetime-local" value={walkthroughAt} onChange={(event) => setWalkthroughAt(event.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Walk-through note (where to meet, access)</p>
            <Textarea value={walkthroughNote} onChange={(event) => setWalkthroughNote(event.target.value)} placeholder="e.g. Meet at the management office, bring ID" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Bids close</p>
            <Input type="datetime-local" value={bidCloseAt} onChange={(event) => setBidCloseAt(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={pending || !bidCloseAt}
            onClick={() => onSubmit({
              ...(walkthroughAt ? { walkthroughAt: fmt(walkthroughAt) } : {}),
              ...(walkthroughNote.trim() ? { walkthroughNote: walkthroughNote.trim() } : {}),
              bidCloseAt: fmt(bidCloseAt),
            })}
          >
            {pending ? "Sending…" : "Send to vendors"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RateAndCloseDialog({ scope, onClose, onSubmit, pending }: {
  scope: Scope | null;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [performance, setPerformance] = useState<"good" | "fair" | "poor" | "">("");
  const [amountCharged, setAmountCharged] = useState("");
  const [deduction, setDeduction] = useState("");
  const [deductionReason, setDeductionReason] = useState("");
  const charged = Math.max(0, Number(amountCharged) || 0);
  const cut = Math.min(charged, Math.max(0, Number(deduction) || 0));
  const vendor = String(scope?.state?.vendor || "");
  return (
    <Dialog open={!!scope} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Rate &amp; close</DialogTitle>
          <DialogDescription>{reference(scope) || "Scope"}{vendor ? ` — ${vendor}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium">Vendor performance</p>
            <div className="flex gap-2">
              {(["good", "fair", "poor"] as const).map((value) => (
                <Button key={value} type="button" variant={performance === value ? "default" : "outline"} onClick={() => setPerformance(value)} className="capitalize">{value}</Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Amount charged ($)</p>
            <Input type="number" min="0" step="0.01" value={amountCharged} onChange={(event) => setAmountCharged(event.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Deduction ($, optional)</p>
            <Input type="number" min="0" step="0.01" value={deduction} onChange={(event) => setDeduction(event.target.value)} />
          </div>
          {cut > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">Deduction reason</p>
              <Textarea value={deductionReason} onChange={(event) => setDeductionReason(event.target.value)} />
            </div>
          )}
          <p className="text-sm">Final amount: <span className="font-semibold">${(charged - cut).toFixed(2)}</span></p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={pending || !performance || charged <= 0 || (cut > 0 && !deductionReason.trim())}
            onClick={() => onSubmit({
              performance,
              amountCharged: charged,
              ...(cut > 0 ? { deduction: cut, deductionReason: deductionReason.trim() } : {}),
              finalAmount: charged - cut,
              closedAt: new Date().toISOString(),
            })}
          >
            {pending ? "Closing…" : "Rate & close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
