import { useEffect, useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";

/** True while a client's complaint tools wait for the baseline (Platform Control switch). */
export function useBaselineWaiting(enabled = true): boolean {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    customFetch<{ required: boolean; complete: boolean }>("/api/v1/baseline/status", { responseType: "json" } as never)
      .then((x) => setWaiting(x.required && !x.complete)).catch(() => undefined);
  }, [enabled]);
  return waiting;
}

/** Shown to a client while complaint management waits for FIAREP's baseline walk-through. */
export function BaselineWaitingNote() {
  const waiting = useBaselineWaiting();
  if (!waiting) return null;
  return (
    <Link href="/baseline-report" className="block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">Building baseline assessment not done yet</p>
      <p className="text-xs text-amber-800">Complaint and violation management starts once FIAREP completes the walk-through of your building. Residents can still send complaints.</p>
    </Link>
  );
}
