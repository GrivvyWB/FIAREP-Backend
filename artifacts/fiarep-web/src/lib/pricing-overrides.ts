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

// A saved set of bands counts only if it has the same band structure as the
// shipped ladder; after the ladder's bands change, an old save is ignored.
export function bands(o: Overrides | null = cache): Band[] {
  const saved = o?.bands;
  if (!saved || saved.length !== BANDS.length) return BANDS;
  if (saved.some((b, i) => b.from !== BANDS[i]!.from || b.to !== BANDS[i]!.to)) return BANDS;
  return saved;
}

export function usePricing(): Overrides & { loaded: boolean; priceOf: (key: PriceKey | string) => number; bands: Band[] } {
  const [o, setO] = useState<Overrides | null>(cache);
  useEffect(() => {
    const l = (v: Overrides) => setO(v);
    listeners.add(l);
    void loadPricing();
    return () => { listeners.delete(l); };
  }, []);
  const cur = o ?? EMPTY;
  return { ...cur, loaded: o != null, priceOf: (key) => bookPrice(key, cur), bands: bands(cur) };
}
