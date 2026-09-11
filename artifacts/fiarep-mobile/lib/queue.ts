/** Single SQLite queue schema/migration used by stores and synchronizer. */
export async function ensureQueue(d: any): Promise<void> {
  await d.execAsync(`CREATE TABLE IF NOT EXISTS sync_queue (
    entity TEXT NOT NULL, id TEXT NOT NULL, state TEXT, operation TEXT NOT NULL,
    baseVersion INTEGER, owner TEXT NOT NULL DEFAULT 'legacy',
    status TEXT NOT NULL DEFAULT 'pending', error TEXT,
    PRIMARY KEY(owner,entity,id)
  )`);
  try { await d.execAsync("ALTER TABLE sync_queue ADD COLUMN owner TEXT NOT NULL DEFAULT 'legacy'"); } catch {}
  const columns = await d.getAllAsync('PRAGMA table_info(sync_queue)') as any[];
  const pk = columns.filter((c: any) => c.pk).sort((a: any, b: any) => a.pk - b.pk).map((c: any) => c.name);
  if (pk.join(',') === 'owner,entity,id') return;
  await d.withTransactionAsync(async () => d.execAsync(`ALTER TABLE sync_queue RENAME TO sync_queue_legacy;
    CREATE TABLE sync_queue(entity TEXT NOT NULL,id TEXT NOT NULL,state TEXT,operation TEXT NOT NULL,
    baseVersion INTEGER,owner TEXT NOT NULL DEFAULT 'legacy',status TEXT NOT NULL DEFAULT 'pending',error TEXT,
    PRIMARY KEY(owner,entity,id));
    INSERT OR IGNORE INTO sync_queue(entity,id,state,operation,baseVersion,owner,status,error)
    SELECT entity,id,state,operation,baseVersion,COALESCE(owner,'legacy'),status,error FROM sync_queue_legacy;
    DROP TABLE sync_queue_legacy;`));
}

export async function recoverLegacyQueue(
  d: any,
  staff: { id?: string; tenantId?: string },
  evidence?: { staffId?: string; tenantId?: string },
): Promise<void> {
  const marker = await d.getFirstAsync('SELECT value FROM settings WHERE key=?', 'sync_queue_legacy_migration') as { value: string } | null;
  if (marker?.value === 'claimed') return;
  const owner = `${staff.tenantId || 'default'}:${staff.id || ''}`;
  if (evidence?.staffId && evidence.staffId === staff.id && evidence.tenantId === staff.tenantId) {
    await d.runAsync("UPDATE sync_queue SET owner=? WHERE owner='legacy'", owner);
    await d.runAsync("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", 'sync_queue_legacy_migration', 'claimed');
  } else {
    await d.runAsync("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", 'sync_queue_legacy_migration', 'recovery-required');
  }
}