// Vendor change work orders with an offline outbox. A vendor on a site with no
// service fills the form; it is saved on the phone and pushed to the server as
// soon as the app has service again (on the next open of the Vendor screen,
// after any action, or by the retry timer).
import { customFetch } from '@workspace/api-client-react';
import { db } from './store';

export type VendorChangeOrderDraft = {
  id: string;               // local id; also sent as clientId so a retry never duplicates
  trackingId: string;
  vendorName: string;
  description: string;
  reason: string;
  measurements: string;
  notes: string;
  cost: number;
  photos: string[];         // data URLs
  createdAt: string;
  attempts: number;
  lastError?: string;
};

export type VendorChangeOrderView = {
  id: string; createdAt: string; status: string; description: string; vendorReason: string; measurements: string;
  notes: string; cost: number; photoCount: number; receivedBy: string[]; receivedAt: string;
  respondedByName: string; respondedAt: string; reason: string;
  pending?: boolean;        // still in the outbox (no service yet)
  lastError?: string;
};

async function ensureTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS vendor_change_order_outbox (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch {}
}

export async function listOutbox(trackingId?: string): Promise<VendorChangeOrderDraft[]> {
  const d = await db();
  await ensureTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM vendor_change_order_outbox');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as VendorChangeOrderDraft; } catch { return null; } }).filter(Boolean) as VendorChangeOrderDraft[];
  return items.filter((x) => !trackingId || x.trackingId === trackingId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function queueVendorChangeOrder(draft: Omit<VendorChangeOrderDraft, 'attempts' | 'createdAt' | 'id'> & { id?: string }): Promise<VendorChangeOrderDraft> {
  const d = await db();
  await ensureTable(d);
  const item: VendorChangeOrderDraft = {
    ...draft,
    id: draft.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await d.runAsync('INSERT OR REPLACE INTO vendor_change_order_outbox (id,state) VALUES (?,?)', item.id, JSON.stringify(item));
  return item;
}

let flushing: Promise<{ sent: number; left: number }> | null = null;
/** Push everything waiting in the outbox. Safe to call often. */
export function flushVendorOutbox(): Promise<{ sent: number; left: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    const d = await db();
    await ensureTable(d);
    let sent = 0;
    const items = await listOutbox();
    for (const item of items) {
      try {
        await customFetch(`/api/v1/public/vendor-scopes/${encodeURIComponent(item.trackingId)}/change-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: item.id, vendorName: item.vendorName, description: item.description, reason: item.reason,
            measurements: item.measurements, notes: item.notes, cost: item.cost, photos: item.photos, createdAt: item.createdAt,
          }),
          responseType: 'json',
        });
        await d.runAsync('DELETE FROM vendor_change_order_outbox WHERE id = ?', item.id);
        sent += 1;
      } catch (e: any) {
        const status = e?.status || e?.response?.status;
        // The server said no for good (wrong vendor, job complete, missing
        // fields): keep it but stop retrying; the vendor sees why.
        const message = String(e?.data?.error || e?.message || 'No service');
        const next = { ...item, attempts: item.attempts + 1, lastError: status && status !== 0 && status < 500 && status !== 408 && status !== 429 ? `Rejected: ${message}` : message };
        await d.runAsync('UPDATE vendor_change_order_outbox SET state = ? WHERE id = ?', JSON.stringify(next), item.id);
      }
    }
    const left = (await listOutbox()).length;
    return { sent, left };
  })();
  try { return flushing; } finally { flushing.finally(() => { flushing = null; }); }
}

export async function removeFromOutbox(id: string): Promise<void> {
  const d = await db();
  await ensureTable(d);
  await d.runAsync('DELETE FROM vendor_change_order_outbox WHERE id = ?', id);
}

/** Server list for this job (empty when offline) merged with what is still waiting on the phone. */
export async function listVendorChangeOrders(trackingId: string, vendorName: string): Promise<VendorChangeOrderView[]> {
  let remote: VendorChangeOrderView[] = [];
  try {
    const rows = await customFetch<VendorChangeOrderView[]>(
      `/api/v1/public/vendor-scopes/${encodeURIComponent(trackingId)}/change-orders?vendorName=${encodeURIComponent(vendorName)}`,
      { responseType: 'json' },
    );
    remote = Array.isArray(rows) ? rows : [];
  } catch { remote = []; }
  const pending = (await listOutbox(trackingId)).map<VendorChangeOrderView>((x) => ({
    id: x.id, createdAt: x.createdAt, status: 'pending', description: x.description, vendorReason: x.reason,
    measurements: x.measurements, notes: x.notes, cost: x.cost, photoCount: x.photos.length, receivedBy: [], receivedAt: '',
    respondedByName: '', respondedAt: '', reason: '', pending: true, lastError: x.lastError,
  }));
  return [...pending, ...remote];
}
