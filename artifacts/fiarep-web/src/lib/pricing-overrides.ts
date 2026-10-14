// Owner-set prices, loaded once from the server and shared by every page that
// shows a number: the price book, contracts, job-request prefill, the public
// plan card and the public estimate table. The defaults ship in
// repair-prices.ts and pricing-ladder.ts; what the owner types in Platform
// Control → Repair price book overrides them.
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { REPAIR_ITEMS, REPAIR_SQFT, type PriceKey } from "@/lib/repair-prices";
import { BANDS, type Band } from "@/lib/pricing-ladder";

export type Overrides = { items: Record<string, number>; bands: Band[] | null; updatedAt: string | null; updatedBy: string | null };

const EMPTY: Overrides = { items: {}, bands: null, updatedAt: null, updatedBy: null };
let cache: Overrides | null = null;
let loading: Promise<Overrides> | null = null;
const listeners = new Set<(o: Overrides) => void>();

function publish(o: Overrides) { cache = o; for (const l of listeners) l(o); }

export function loadPricing(): Promise<Overrides> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = customFetch<Overrides>("/api/v1/pricing", { responseType: "json" } as never)
      .then((o) => { const v = { ...EMPTY, ...o, items: o?.items || {} }; publish(v); return v; })
      .catch(() => { publish(EMPTY); return EMPTY; })
      .finally(() => { loading = null; });
  }
  return loading;
}

let refreshing: Promise<Overrides> | null = null;

/** Pull the owner's current numbers, past the cache. Every page that shows a
 *  price calls this as it mounts, so a rate changed in Platform Control reaches
 *  a tab that is already open instead of waiting for a reload. Concurrent
 *  callers share the one request. */
export function refreshPricing(): Promise<Overrides> {
  if (!refreshing) {
    refreshing = customFetch<Overrides>("/api/v1/pricing", { responseType: "json" } as never)
      .then((o) => { const v = { ...EMPTY, ...o, items: o?.items || {} }; publish(v); return v; })
      // Offline or a failed call keeps whatever is already on screen.
      .catch(() => cache ?? EMPTY)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Save the owner's numbers (Platform Control only). Pass only what changed. */
export async function savePricing(patch: { items?: Record<string, number>; bands?: Band[] | null }): Promise<Overrides> {
  const o = await customFetch<Overrides>("/api/v1/platform/pricing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch), responseType: "json" } as never);
  const v = { ...EMPTY, ...o, items: o?.items || {} };
  publish(v);
  return v;
}

const BOOK: Record<string, number> = Object.fromEntries([...REPAIR_ITEMS, ...REPAIR_SQFT].map((i) => [i[0], i[2]]));

/** The book price for a line — the owner's number if set, otherwise the shipped default. */
export function bookPrice(key: PriceKey | string, o: Overrides | null = cache): number {
  const v = o?.items?.[key];
  return typeof v === "number" ? v : (BOOK[key] ?? 0);
}
export function defaultPrice(key: PriceKey | string): number { return BOOK[key] ?? 0; }

// Saved band values follow the shipped band they were saved for (same from and
// to). When the ladder's bands change, a band that still exists keeps what the
// owner saved; a new or reshaped band starts from the shipped numbers.
export function bands(o: Overrides | null = cache): Band[] {
  const saved = o?.bands;
  if (!saved || !Array.isArray(saved)) return BANDS;
  return BANDS.map((b) => {
    const s = saved.find((x) => x && x.from === b.from && x.to === b.to);
    return s ? { ...b, platformRate: s.platformRate, platformMin: s.platformMin, planRate: s.planRate, planMin: s.planMin } : b;
  });
}

export function usePricing(): Overrides & { loaded: boolean; priceOf: (key: PriceKey | string) => number; bands: Band[] } {
  const [o, setO] = useState<Overrides | null>(cache);
  useEffect(() => {
    const l = (v: Overrides) => setO(v);
    listeners.add(l);
    // Cached copy first so nothing flickers, then the live numbers.
    void loadPricing();
    void refreshPricing();
    return () => { listeners.delete(l); };
  }, []);
  const cur = o ?? EMPTY;
  return { ...cur, loaded: o != null, priceOf: (key) => bookPrice(key, cur), bands: bands(cur) };
}
