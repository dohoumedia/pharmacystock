import { createClient } from '@supabase/supabase-js';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboxOperation } from './outbox';
import type { KeyValueStorage } from './storage';

const ownerKey = 'pharmacystock:offline-scope:v1:user-id';
const globalKey = 'pharmacystock:outbox:v1:operations';
const zero = { synced: 0, conflicts: 0, failed: 0 };
function memory(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}
function token(owner: string, version = 1) {
  return `${btoa('{}')}.${btoa(JSON.stringify({ sub: owner, version }))}.signature`;
}
function session(owner = 'user-a', version = 1) {
  return { access_token: token(owner, version), refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: owner } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function sale(id = 'sale-a'): OutboxOperation {
  return { id, kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a', idempotencyKey: `stable-${id}`,
    createdAt: '2026-10-04T11:00:00Z', status: 'PENDING', attemptCount: 0,
    payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: id, lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH', amount: 10 }], localReceiptNumber: id, quotedTotal: 10, quoteSyncedAt: '2026-10-04T10:00:00Z' } };
}
async function harness(indexed: boolean) {
  vi.resetModules();
  vi.doUnmock('../services/sales');
  const storage = memory();
  const factory = indexed ? new IDBFactory() : undefined;
  storage.setItem(ownerKey, 'user-a');
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('navigator', {});
  vi.doMock('../lib/env', () => ({ env: { supabaseUrl: 'https://dispatch-test.invalid', supabasePublishableKey: 'sb_publishable_mock' } }));
  const paused = deferred<void>();
  const resumed = deferred<void>();
  let armed = false;
  let stored = session();
  const authFetch = vi.fn(async () => new Response(JSON.stringify(session('user-a', 3)), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  // This is real SDK auth storage: getSession/_useSession/__loadSession await it.
  const source = createClient('https://dispatch-test.invalid', 'sb_publishable_mock', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'mock-session', storage: {
      getItem: async () => {
        if (armed) { armed = false; paused.resolve(); await resumed.promise; }
        return JSON.stringify(stored);
      }, setItem: (_key: string, raw: string) => { stored = JSON.parse(raw); }, removeItem: () => undefined,
    } },
    global: { fetch: authFetch },
  });
  await source.auth.getSession();
  vi.doMock('../lib/supabase', () => ({ supabase: source }));
  vi.doMock('../services/inventory', () => ({ loadInventoryBalances: async () => [] }));
  vi.doMock('./offlinePosCatalog', () => ({ cachePosStockSnapshot: () => undefined }));
  const { offlineSessionScope: scope } = await import('./sessionScope');
  const { OutboxStore } = await import('./outbox');
  const { replayPendingSales } = await import('./offlinePos');
  const outbox = new OutboxStore();
  await scope.bindUser('user-a');
  await outbox.ready();
  const refreshEvents: string[] = [];
  source.auth.onAuthStateChange((event, data) => {
    refreshEvents.push(event);
    if (event === 'TOKEN_REFRESHED') void scope.bindUser(data?.user.id ?? null);
  });
  // Let the SDK's INITIAL_SESSION callback finish its storage read before arming.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const getSession = vi.spyOn(source.auth, 'getSession');
  const operation = sale();
  await outbox.enqueue(operation, 'user-a');
  const response = deferred<Response>();
  let delayResponse = false;
  const dispatched = deferred<void>();
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    dispatched.resolve();
    return delayResponse ? response.promise : new Response(JSON.stringify('server-sale'), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  // Arm exactly when the durable SYNCING claim is committed, after preparation.
  const update = outbox.update.bind(outbox);
  vi.spyOn(outbox, 'update').mockImplementation(async (...args) => {
    const result = await update(...args);
    if (args[1].status === 'SYNCING') armed = true;
    return result;
  });
  return { storage, factory, scope, outbox, OutboxStore, operation, source, getSession, authFetch, refreshEvents, fetch, paused, resumed, dispatched, response,
    setSession: (owner: string, version = 1) => { stored = session(owner, version); },
    setTokenOwner: (owner: string) => { stored.access_token = token(owner); },
    delay: () => { delayResponse = true; },
    replay: (canReplay?: () => boolean) => replayPendingSales(outbox, { expectedOwnerId: 'user-a', canReplay }),
    replaySelected: (selected: typeof outbox) => replayPendingSales(selected, { expectedOwnerId: 'user-a' }),
  };
}
async function installReceipt(h: Awaited<ReturnType<typeof harness>>, path: string, intent: OutboxOperation, malformed: boolean) {
  if (path === 'kv') {
    const key = 'pharmacystock:outbox:v2:key-value-state';
    const state = JSON.parse(h.storage.getItem(key)!);
    const receipt = { ownerId: 'user-a', raw: JSON.stringify({ version: 1, operations: [intent,
      ...(malformed ? [{ ...intent, id: 'malformed-sibling', createdAt: 'invalid' }] : [])] }) };
    h.storage.setItem(key, JSON.stringify({ ...state, legacyGlobalRecovery: receipt }));
    return receipt;
  }
  const key = path === 'global' ? `legacy-local-storage-v1:import:${intent.idempotencyKey}`
    : `${path === 'user' ? 'legacy-session-vault-v1' : 'key-value-outbox-v2'}:import:${JSON.stringify(['user-a', intent.idempotencyKey])}`;
  const receipt = { key, importedId: malformed ? '' : intent.id, sourceFingerprint: JSON.stringify(intent) };
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = h.factory!.open('pharmacystock:outbox:v2', 2);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.objectStore('metadata').put(receipt); }); } finally { db.close(); }
  return receipt;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function installPersistedQuarantine(h: Awaited<ReturnType<typeof harness>>, fields: object, garbage?: { value: unknown }) {
  const key = 'pharmacystock:outbox:v2:key-value-state';
  if (!h.factory) {
    const state = JSON.parse(h.storage.getItem(key)!);
    h.storage.setItem(key, JSON.stringify({ ...state, quarantine: garbage ? garbage.value : [{ ownerId: 'user-a', ...fields }] }));
    return;
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = h.factory!.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    tx.objectStore('metadata').put({ key: 'persisted-outbox-v2:quarantine:"user-a"', ownerId: 'user-a', ...(garbage ? { records: garbage.value } : fields) });
  }); } finally { db.close(); }
}
function quarantineFields(kind: string, operation: OutboxOperation): object {
  if (kind === 'nested') return { records: [{ record: { records: { record: operation } } }] };
  if (kind === 'direct') return { records: [{ record: operation, reason: 'IMMUTABLE_CONFLICT' }] };
  if (kind === 'entry record') return { record: operation, reason: 'IMMUTABLE_CONFLICT' };
  if (kind === 'raw') return { raw: JSON.stringify({ records: { record: operation } }), reason: 'IMMUTABLE_CONFLICT' };
  return { records: { record: operation } };
}

describe('real SDK replay dispatch boundary', () => {
  it.each(['record', 'records', 'raw', 'nested'])(
    'native foreign-vault %s valid B row introduced during SDK acquisition fences A only', async shape => {
      const h = await harness(false); await h.outbox.enqueue(sale('unrelated'), 'user-a');
      const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a'; const source = JSON.stringify({ operations: [h.operation] });
      h.storage.setItem(vaultKey, source); expect(await h.outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true);
      const replay = h.replay(); await h.paused.promise;
      const child = { ...h.operation, ownerId: 'user-a', payload: { ...h.operation.payload as object, saleNumber: 'B' }, record: { ...sale('unrelated'), ownerId: 'user-b' } };
      const wrapper = { ...sale('foreign-b'), ownerId: 'user-b', ...(shape === 'records' ? { records: [child] } : shape === 'raw' ? { raw: JSON.stringify(child) }
        : shape === 'nested' ? { record: { records: { raw: JSON.stringify(child) } } } : { record: child }) };
      const key = 'pharmacystock:outbox:v2:key-value-state'; const state = JSON.parse(h.storage.getItem(key)!);
      h.storage.setItem(key, JSON.stringify({ ...state, vaults: { ...state.vaults, 'user-b': [wrapper] } }));
      // Storage injection only after the actual SDK auth-storage pause. No refresh/import/recovery before resuming.
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 });
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(0); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
      expect(await h.outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false); expect(h.storage.getItem(vaultKey)).toBe(source);
      expect(JSON.parse(h.storage.getItem(key)!).vaults['user-b']).toEqual([wrapper]);
      await h.scope.bindUser('user-b'); expect(await h.outbox.refresh('user-b')).toEqual([wrapper]); await h.scope.bindUser('user-a');
      expect(await new h.OutboxStore().refresh('user-a')).toEqual([]); expect(h.storage.getItem(vaultKey)).toBe(source);
    });
  it.each(['unowned', 'foreign', 'garbage', 'identical'])(
    'native foreign-vault %s control preserves valid A/C submission', async kind => {
      const h = await harness(false); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = kind === 'garbage' ? 'garbage' : { ...h.operation, ...(kind === 'identical' ? { ownerId: 'user-a' }
        : { payload: { ...h.operation.payload as object, saleNumber: 'B' }, ...(kind === 'foreign' ? { ownerId: 'user-b' } : {}) }) };
      const wrapper = { ...sale('foreign-b'), ownerId: 'user-b', record: child }; const key = 'pharmacystock:outbox:v2:key-value-state'; const state = JSON.parse(h.storage.getItem(key)!);
      h.storage.setItem(key, JSON.stringify({ ...state, vaults: { ...state.vaults, 'user-b': [wrapper] } }));
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 2 });
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(1); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
      await h.scope.bindUser('user-b'); expect(await h.outbox.refresh('user-b')).toEqual([wrapper]);
    });

  it.each(['physical', 'archive', 'invalid-version', 'invalid-slot', 'root-array', 'root-string'].flatMap(path => ['record', 'records', 'raw', 'nested'].map(shape => [path, shape] as const)))(
    'foreign-vault %s %s inserted during SDK token acquisition is evidence-only and blocks A, not C', async (path, shape) => {
      const h = await harness(true); await h.outbox.enqueue(sale('unrelated'), 'user-a');
      const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a'; const source = JSON.stringify({ operations: [h.operation] }); h.storage.setItem(vaultKey, source);
      const replay = h.replay(); await h.paused.promise;
      const child = { ...h.operation, id: 'b', ownerId: 'user-a', payload: { ...h.operation.payload as object, saleNumber: 'B' }, record: { ...sale('unrelated'), ownerId: 'user-b' } };
      const wrapper = { id: 'foreign-wrapper', ownerId: 'user-b', idempotencyKey: 'foreign-wrapper-key', ...(shape === 'records' ? { records: [child] }
        : shape === 'raw' ? { raw: JSON.stringify(child) } : shape === 'nested' ? { record: { records: { raw: JSON.stringify(child) } } } : { record: child }) };
      let raw: string | null = null;
      if (path === 'physical') {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = h.factory!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('vaultOperations', 'readwrite'); tx.objectStore('vaultOperations').put(wrapper); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
      } else {
        const base = { version: path === 'invalid-version' ? 99 : 2, ownerId: 'user-a', operations: [], vaults: { 'user-b': path === 'invalid-slot' ? { records: [wrapper] } : [wrapper] } };
        raw = JSON.stringify(path === 'root-array' ? [base] : path === 'root-string' ? JSON.stringify(base) : base); h.storage.setItem('pharmacystock:outbox:v2:key-value-state', raw);
      }
      // Direct storage mutation only: no recovery/import/refresh before resume.
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 });
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(0); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
      expect(h.storage.getItem(vaultKey)).toBe(source); if (raw !== null) expect(h.storage.getItem('pharmacystock:outbox:v2:key-value-state')).toBe(raw);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a'); expect(await new h.OutboxStore().refresh('user-a')).toEqual([]);
    });
  it.each(['physical', 'archive', 'invalid-version'].flatMap(path => ['unowned', 'foreign', 'garbage', 'identical'].map(kind => [path, kind] as const)))(
    'foreign-vault %s %s control preserves valid A/C dispatch and stable idempotency', async (path, kind) => {
      const h = await harness(true); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = kind === 'garbage' ? 'garbage' : { ...h.operation, ...(kind === 'identical' ? { ownerId: 'user-a' }
        : { payload: { ...h.operation.payload as object, saleNumber: 'B' }, ...(kind === 'foreign' ? { ownerId: 'user-b' } : {}) }) };
      const wrapper = { id: 'foreign-wrapper', ownerId: 'user-b', idempotencyKey: 'foreign-wrapper-key', record: child };
      if (path === 'physical') {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = h.factory!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('vaultOperations', 'readwrite'); tx.objectStore('vaultOperations').put(wrapper); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
      } else h.storage.setItem('pharmacystock:outbox:v2:key-value-state', JSON.stringify({ version: path === 'invalid-version' ? 99 : 2, ownerId: 'user-a', operations: [], vaults: { 'user-b': [wrapper] } }));
      h.resumed.resolve(); const tainted = path === 'invalid-version' && kind === 'identical'; expect(await replay).toEqual({ ...zero, synced: tainted ? 1 : 2 });
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(tainted ? 0 : 1); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
    });

  it.each(['quarantine-namespace', 'native-broken-map', 'archive-broken-map'])(
    'namespace %s explicit A leaf near actual depth limit still fences real SDK while C dispatches', async path => {
      const h = await harness(path !== 'native-broken-map'); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const { OUTBOX_EVIDENCE_MAX_DEPTH } = await import('./outboxRecovery');
      let nested: unknown = { ...h.operation, ownerId: 'user-a', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH - 1; i++) nested = { ownerId: 'user-b', record: nested };
      const marker = { ownerId: 'user-b', record: nested };
      if (path === 'quarantine-namespace') {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = h.factory!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put({ key: 'persisted-outbox-v2:quarantine:"user-b"', ...marker }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
      } else {
        const key = 'pharmacystock:outbox:v2:key-value-state'; const state = path === 'native-broken-map' ? JSON.parse(h.storage.getItem(key)!) : { version: 2, ownerId: 'user-a', operations: [], vaults: {} };
        h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { ...state.legacyVaultReceipts, broken: marker } }));
      }
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
    });
  it.each([false, true])('namespace retained legacy quarantine explicit=%s obeys the same physical B inheritance at SDK dispatch', async explicit => {
    const h = await harness(true); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
    const child = { ...h.operation, payload: { ...h.operation.payload as object, saleNumber: 'B' }, ...(explicit ? { ownerId: 'user-a' } : {}) };
    const retained = { key: 'legacy-session-vault-v1:quarantine:user-b', raw: JSON.stringify({ records: [child] }) };
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = h.factory!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put(retained); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: explicit ? 1 : 2 });
    const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
    expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(explicit ? 0 : 1); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
  });

  it.each(['quarantine-namespace', 'native-broken-map', 'archive-broken-map'].flatMap(path => ['record', 'records', 'raw', 'nested', 'fingerprint'].map(shape => [path, shape] as const)))(
    'namespace %s %s explicitly A descendant introduced during actual SDK acquisition blocks A only', async (path, shape) => {
      const h = await harness(path !== 'native-broken-map'); await h.outbox.enqueue(sale('unrelated'), 'user-a');
      const retainedSource = JSON.stringify({ operations: [h.operation] }); const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a';
      h.storage.setItem(vaultKey, retainedSource); const replay = h.replay(); await h.paused.promise;
      const child = { ...h.operation, id: 'b', ownerId: 'user-a', payload: { ...h.operation.payload as object, saleNumber: 'B' }, record: { ...sale('unrelated'), ownerId: 'user-b' } };
      const marker = { ownerId: 'user-b', ...(shape === 'records' ? { records: [child] } : shape === 'raw' ? { raw: JSON.stringify(child) }
        : shape === 'fingerprint' ? { sourceFingerprint: JSON.stringify(child) } : shape === 'nested' ? { records: { record: { raw: JSON.stringify(child) } } } : { record: child }) };
      if (path === 'quarantine-namespace') {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = h.factory!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite');
          tx.objectStore('metadata').put({ key: 'persisted-outbox-v2:quarantine:"user-b"', ...marker }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
      } else {
        const key = 'pharmacystock:outbox:v2:key-value-state'; const state = path === 'native-broken-map' ? JSON.parse(h.storage.getItem(key)!) : { version: 2, ownerId: 'user-a', operations: [], vaults: {} };
        h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { ...state.legacyVaultReceipts, broken: marker } }));
      }
      // No recovery/import/refresh between this raw write and the actual SDK resume.
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 });
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(0); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
      expect(h.storage.getItem(vaultKey)).toBe(retainedSource);
      expect((await h.outbox.refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      expect((await new h.OutboxStore().refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
    });
  it.each(['quarantine-namespace', 'native-broken-map', 'archive-broken-map'].flatMap(path => ['unowned', 'foreign', 'garbage'].map(kind => [path, kind] as const)))(
    'namespace %s %s child stays foreign while A/C dispatch normally', async (path, kind) => {
      const h = await harness(path !== 'native-broken-map'); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = kind === 'garbage' ? 'unidentifiable' : { ...h.operation, id: 'b', payload: { ...h.operation.payload as object, saleNumber: 'B' }, ...(kind === 'foreign' ? { ownerId: 'user-b' } : {}) };
      const marker = { ...(path === 'quarantine-namespace' ? {} : { ownerId: 'user-b' }), record: child };
      if (path === 'quarantine-namespace') {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = h.factory!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put({ key: 'persisted-outbox-v2:quarantine:"user-b"', ...marker }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
      } else {
        const key = 'pharmacystock:outbox:v2:key-value-state'; const state = path === 'native-broken-map' ? JSON.parse(h.storage.getItem(key)!) : { version: 2, ownerId: 'user-a', operations: [], vaults: {} };
        h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { ...state.legacyVaultReceipts, broken: marker } }));
      }
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 2 });
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(1); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
    });

  it.each([false, true])('ownership indexed=%s contradicted proof A keeps independent valid owned C available through actual SDK', async indexed => {
    const h = await harness(indexed); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
    const encoded = JSON.stringify(['user-a', h.operation.idempotencyKey]); const body = { ...h.operation, ownerId: 'user-b', record: { ...sale('unrelated'), ownerId: 'user-a' } };
    const receipt = { key: 'legacy-session-vault-v1:import:' + encoded, ownerId: 'user-a', importedId: h.operation.id, sourceFingerprint: JSON.stringify(body) };
    const key = 'pharmacystock:outbox:v2:key-value-state'; const state = indexed ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(h.storage.getItem(key)!);
    h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: receipt } }));
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
  });
  it.each(['archive', 'native-global'].flatMap(path => [false, true].map(identical => [path, identical] as const)))(
    'ownership foreign ordinary %s source identical=%s independently routes owned A evidence without adopting completion', async (path, identical) => {
      const h = await harness(path === 'archive'); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = { ...h.operation, ownerId: 'user-a', ...(identical ? {} : { payload: { ...h.operation.payload as object, saleNumber: 'different' } }) };
      if (path === 'archive') h.storage.setItem('pharmacystock:outbox:v2:key-value-state', JSON.stringify({ version: 2, ownerId: 'user-b', operations: [child], vaults: {} }));
      else { h.storage.setItem(ownerKey, 'user-b'); h.storage.setItem(globalKey, JSON.stringify({ version: 1, operations: [child] })); }
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: identical ? 2 : 1 }); expect(h.fetch).toHaveBeenCalledTimes(identical ? 2 : 1);
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(identical ? 1 : 0); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
    });

  it.each(['native-map', 'archive-map', 'metadata-user', 'live-global'])(
    'ownership foreign %s collector still routes an explicit A fingerprint/descendant during SDK acquisition', async path => {
      const h = await harness(path !== 'native-map'); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = { ...h.operation, ownerId: 'user-a', payload: { ...h.operation.payload as object, saleNumber: 'foreign-proof-child' } };
      if (path === 'live-global') {
        h.storage.setItem(ownerKey, 'user-b'); h.storage.setItem(globalKey, JSON.stringify({ version: 1, operations: [child] }));
      } else {
        const encoded = JSON.stringify(['user-b', h.operation.idempotencyKey]); const receipt = { key: 'legacy-session-vault-v1:import:' + encoded,
          ownerId: 'user-b', importedId: child.id, sourceFingerprint: JSON.stringify(child) };
        if (path === 'metadata-user') {
          const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = h.factory!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
          try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put(receipt); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
        } else {
          const key = 'pharmacystock:outbox:v2:key-value-state'; const state = path === 'archive-map' ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(h.storage.getItem(key)!);
          h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: receipt } }));
        }
      }
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
      expect((await h.outbox.refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
    });
  it.each([false, true].flatMap(indexed => ['user-a', 'absent', 'user-b', 'different foreign key'].map(fingerprintOwner => [indexed, fingerprintOwner] as const)))(
    'ownership indexed=%s receipt fingerprint=%s preserves valid controls and isolates contradicted key A from C', async (indexed, fingerprintOwner) => {
      const h = await harness(indexed); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const intent = fingerprintOwner === 'different foreign key' ? { ...sale('unrelated'), ownerId: 'user-b' }
        : { ...h.operation, ...(fingerprintOwner === 'absent' ? {} : { ownerId: fingerprintOwner }) };
      const encoded = JSON.stringify(['user-a', h.operation.idempotencyKey]); const receipt = { key: 'legacy-session-vault-v1:import:' + encoded,
        ownerId: 'user-a', importedId: h.operation.id, sourceFingerprint: JSON.stringify(intent) };
      const key = 'pharmacystock:outbox:v2:key-value-state'; const state = indexed ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(h.storage.getItem(key)!);
      h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: receipt } }));
      h.resumed.resolve(); const allowed = fingerprintOwner === 'user-a' || fingerprintOwner === 'absent';
      expect(await replay).toEqual({ ...zero, synced: allowed ? 2 : 1 }); expect(h.fetch).toHaveBeenCalledTimes(allowed ? 2 : 1);
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(allowed ? 1 : 0); expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
    });

  it.each([false, true].flatMap(indexed => ['record', 'records', 'raw', 'fingerprint'].flatMap(shape => [false, true].map(array => [indexed, shape, array] as const))))(
    'ownership indexed=%s foreign %s array=%s wrapper routes explicit A child during actual SDK acquisition', async (indexed, shape, array) => {
      const h = await harness(indexed); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = { ...h.operation, id: 'b', ownerId: 'user-a', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      const wrapper = { ownerId: 'user-b', ...(shape === 'records' ? { records: [child] } : shape === 'raw' ? { raw: JSON.stringify(child) }
        : shape === 'fingerprint' ? { sourceFingerprint: JSON.stringify(child) } : { record: child }) };
      await installPersistedQuarantine(h, {}, { value: array ? [wrapper] : wrapper });
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
      expect((await h.outbox.refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      expect((await new h.OutboxStore().refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
    });
  it.each([false, true].flatMap(indexed => ['unowned', 'foreign'].map(childOwner => [indexed, childOwner] as const)))(
    'ownership indexed=%s foreign parent does not adopt its %s child into A during SDK dispatch', async (indexed, childOwner) => {
      const h = await harness(indexed); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = { ...h.operation, id: 'b', ...(childOwner === 'foreign' ? { ownerId: 'user-b' } : {}), payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      await installPersistedQuarantine(h, {}, { value: [{ ownerId: 'user-b', record: child }] });
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 2 }); expect(h.fetch).toHaveBeenCalledTimes(2);
    });
  it.each(['native-map', 'native-global', 'archive-map', 'user', 'handoff', 'global'])(
    'ownership %s contradictory fingerprint introduced while SDK awaits auth cannot prove completion or dispatch A', async path => {
      const h = await harness(!path.startsWith('native')); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const intent = { ...h.operation, ownerId: 'user-b' }; const encoded = JSON.stringify(['user-a', h.operation.idempotencyKey]);
      if (path === 'native-map' || path === 'native-global' || path === 'archive-map') {
        const key = 'pharmacystock:outbox:v2:key-value-state'; const state = path === 'archive-map' ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(h.storage.getItem(key)!);
        const receipt = path === 'native-global' ? { legacyGlobalRecovery: { ownerId: 'user-a', raw: JSON.stringify({ version: 1, operations: [intent] }) } }
          : { legacyVaultReceipts: { [encoded]: { key: 'legacy-session-vault-v1:import:' + encoded, ownerId: 'user-a', importedId: intent.id, sourceFingerprint: JSON.stringify(intent) } } };
        h.storage.setItem(key, JSON.stringify({ ...state, ...receipt }));
      } else await installReceipt(h, path, intent, false);
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
      expect((await h.outbox.refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a'); expect((await new h.OutboxStore().refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
    });

  it.each(['operations', 'vault'].flatMap(field => ['record', 'same key', 'raw', 'malformed child', 'unrelated child'].map(shape => [field, shape] as const)))(
    'binding archive %s keyed %s inserted during SDK acquisition scopes dispatch to undisputed work', async (field, shape) => {
      const h = await harness(true); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = shape === 'unrelated child' ? sale('unrelated') : shape === 'malformed child' ? { ...h.operation, id: 'bad-child', createdAt: 'invalid' }
        : { ...h.operation, id: 'b', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      const wrapper = { idempotencyKey: shape === 'same key' ? h.operation.idempotencyKey : 'wrapper-key',
        ...(shape === 'raw' ? { raw: JSON.stringify({ record: child }) } : { record: child }) };
      const key = 'pharmacystock:outbox:v2:key-value-state'; const raw = JSON.stringify({ version: 2, ownerId: 'user-a',
        operations: field === 'operations' ? [wrapper] : [], vaults: field === 'vault' ? { 'user-a': [wrapper] } : {} });
      h.storage.setItem(key, raw); // No recovery/import/refresh before actual SDK dispatch.
      h.resumed.resolve(); const permitted = shape === 'unrelated child' ? 2 : 1;
      expect(await replay).toEqual({ ...zero, synced: permitted }); expect(h.fetch).toHaveBeenCalledTimes(permitted);
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(shape === 'unrelated child' ? 1 : 0);
      expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1); expect(h.storage.getItem(key)).toBe(raw);
      if (shape !== 'unrelated child') { expect((await h.outbox.refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
        expect((await new h.OutboxStore().refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false); }
    });
  it.each(['operations', 'vaultOperations'].flatMap(store => ['record', 'raw', 'malformed child', 'unrelated child'].map(shape => [store, shape] as const)))(
    'binding malformed destination %s %s inserted during actual SDK acquisition fences descendants without refresh', async (store, shape) => {
      const h = await harness(true); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const child = shape === 'unrelated child' ? sale('unrelated') : shape === 'malformed child' ? { ...h.operation, id: 'bad-child', createdAt: 'invalid' }
        : { ...h.operation, id: 'b', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      const wrapper = { id: 'wrapper', idempotencyKey: 'wrapper-key', ...(store === 'vaultOperations' ? { ownerId: 'user-a' } : {}),
        ...(shape === 'raw' ? { raw: JSON.stringify({ record: child }) } : { record: child }) };
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = h.factory!.open('pharmacystock:outbox:v2', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(wrapper); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
      h.resumed.resolve(); const permitted = shape === 'unrelated child' ? 2 : 1;
      expect(await replay).toEqual({ ...zero, synced: permitted }); expect(h.fetch).toHaveBeenCalledTimes(permitted);
      const keys = h.fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string).p_idempotency_key);
      expect(keys.filter(key => key === h.operation.idempotencyKey)).toHaveLength(shape === 'unrelated child' ? 1 : 0);
      expect(keys.filter(key => key === 'stable-unrelated')).toHaveLength(1);
      if (shape !== 'unrelated child') expect((await new h.OutboxStore().refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
    });
  it.each([false, true].flatMap(indexed => ['nodes', 'depth'].map(limit => [indexed, limit] as const)))(
    'binding indexed=%s %s receipt fingerprint arrays preserve known key A while C dispatches through real SDK', async (indexed, limit) => {
      const h = await harness(indexed); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
      const { OUTBOX_EVIDENCE_MAX_DEPTH, OUTBOX_EVIDENCE_MAX_NODES } = await import('./outboxRecovery');
      let fingerprint: unknown = 'garbage';
      if (limit === 'nodes') fingerprint = Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 4 }, () => 'garbage');
      else for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH + 4; i++) fingerprint = [fingerprint];
      const encoded = JSON.stringify(['user-a', h.operation.idempotencyKey]); const marker = { key: 'legacy-session-vault-v1:import:' + encoded,
        importedId: h.operation.id, sourceFingerprint: JSON.stringify(fingerprint) };
      const key = 'pharmacystock:outbox:v2:key-value-state'; const state = indexed ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(h.storage.getItem(key)!);
      h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: marker } }));
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
      expect((await h.outbox.refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      expect((await new h.OutboxStore().refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
    });

  it.each([false, true].flatMap(indexed => [false, true].map(unrelated => [indexed, unrelated] as const)))(
    'indexed=%s mixed receipt map introduced inside SDK acquisition fences disputed work; unrelated=%s', async (indexed, unrelated) => {
      const h = await harness(indexed); if (unrelated) await h.outbox.enqueue(sale('unrelated'), 'user-a');
      const replay = h.replay(); await h.paused.promise;
      const historical = { ...h.operation, id: 'historical-a', payload: { ...h.operation.payload as object, saleNumber: 'historical-other' } };
      const encoded = JSON.stringify(['user-a', h.operation.idempotencyKey]);
      const marker = { key: 'legacy-session-vault-v1:import:' + encoded, importedId: historical.id, sourceFingerprint: JSON.stringify(historical) };
      const root = { [encoded]: marker, raw: 'unidentifiable garbage' }; const key = 'pharmacystock:outbox:v2:key-value-state';
      const state = indexed ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(h.storage.getItem(key)!);
      h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: root }));
      // No refresh/import/recovery runs before the guarded SDK request resumes.
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: unrelated ? 1 : 0 });
      expect(h.fetch).toHaveBeenCalledTimes(unrelated ? 1 : 0);
      if (unrelated) expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
      expect((await h.outbox.refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
      expect(JSON.parse(h.storage.getItem(key)!).legacyVaultReceipts).toEqual(root);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      expect((await new h.OutboxStore().refresh('user-a')).some(row => row.id === h.operation.id)).toBe(false);
    });
  it.each(['operations', 'vault'].flatMap(field => ['depth', 'nodes'].map(limit => [field, limit] as const)))(
    'late archive %s %s exhaustion during SDK token acquisition fences without recovery', async (field, limit) => {
      const h = await harness(true); const replay = h.replay(); await h.paused.promise;
      const b = { ...h.operation, id: 'b', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      let uncertain: unknown = b;
      if (limit === 'depth') for (let i = 0; i < 70; i++) uncertain = { record: uncertain };
      else uncertain = { records: [...Array.from({ length: 4100 }, () => 'garbage'), b] };
      const raw = JSON.stringify({ version: 2, ownerId: field === 'operations' ? 'user-a' : 'user-b', operations: field === 'operations' ? uncertain : [], vaults: field === 'vault' ? { 'user-a': uncertain } : {} });
      const key = 'pharmacystock:outbox:v2:key-value-state'; h.storage.setItem(key, raw);
      h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
      expect(await h.outbox.refresh('user-a')).toEqual([]); expect(h.storage.getItem(key)).toBe(raw);
      expect(await new h.OutboxStore().refresh('user-a')).toEqual([]);
    });
  it.each(['global', 'user'].flatMap(path => ['depth', 'nodes'].map(limit => [path, limit] as const)))(
    'native live %s %s exhaustion inserted during actual SDK acquisition requires no recovery pass', async (path, limit) => {
      const h = await harness(false); const replay = h.replay(); await h.paused.promise;
      const b = { ...h.operation, id: 'b', payload: { ...h.operation.payload as object, saleNumber: 'B' } }; let uncertain: unknown = b;
      if (limit === 'depth') for (let i = 0; i < 70; i++) uncertain = { record: uncertain };
      else uncertain = { records: [...Array.from({ length: 4100 }, () => 'garbage'), b] };
      const raw = JSON.stringify({ version: 1, operations: [uncertain] });
      const key = path === 'global' ? globalKey : 'pharmacystock:offline-scope:v1:vault:user-a'; h.storage.setItem(key, raw);
      h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
      expect(await h.outbox.refresh('user-a')).toEqual([]); expect(h.storage.getItem(key)).toBe(raw);
      expect(await new h.OutboxStore().refresh('user-a')).toEqual([]);
    });
  it.each([false, true])('indexed=%s explicitly foreign >budget quarantine entries do not prevent unchanged SDK dispatch', async indexed => {
    const h = await harness(indexed); const replay = h.replay(); await h.paused.promise;
    const foreign = Array.from({ length: 4100 }, () => ({ ownerId: 'user-b', records: 'foreign garbage' }));
    await installPersistedQuarantine(h, {}, { value: foreign });
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe(h.operation.idempotencyKey);
  });
  it.each([false, true])('indexed=%s keyed receipt uncertainty skips only that key and permits unrelated real SDK replay', async indexed => {
    const h = await harness(indexed); await h.outbox.enqueue(sale('unrelated'), 'user-a'); const replay = h.replay(); await h.paused.promise;
    let fingerprint: unknown = h.operation; for (let i = 0; i < 70; i++) fingerprint = { record: fingerprint };
    const encoded = JSON.stringify(['user-a', h.operation.idempotencyKey]);
    const marker = { key: 'legacy-session-vault-v1:import:' + encoded, importedId: h.operation.id, sourceFingerprint: JSON.stringify(fingerprint) };
    const key = 'pharmacystock:outbox:v2:key-value-state'; const state = indexed ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(h.storage.getItem(key)!);
    h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: marker } }));
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
  });
  it.each([false, true])('indexed=%s genuinely unscoped late exhaustion remains zero-fetch SKIPPED through the real SDK', async indexed => {
    const h = await harness(indexed); const replay = h.replay(); await h.paused.promise;
    await installPersistedQuarantine(h, {}, { value: Array.from({ length: 4100 }, () => 'garbage') });
    h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled(); expect(await h.outbox.refresh('user-a')).toEqual([]);
  });

  it.each([false, true].flatMap((indexed) => ['nested', 'direct', 'entry record', 'raw', 'records object'].map((kind) => [indexed, kind] as const)))(
    'indexed=%s persisted %s during SDK token acquisition rejects A without a recovery pass', async (indexed, kind) => {
      const h = await harness(indexed); const replay = h.replay(); await h.paused.promise;
      const b = { ...h.operation, id: 'disputed-b', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      const raw = JSON.stringify({ operations: [h.operation] }); const sourceKey = 'pharmacystock:offline-scope:v1:vault:user-a'; h.storage.setItem(sourceKey, raw);
      await installPersistedQuarantine(h, quarantineFields(kind, b));
      h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
      expect(await h.outbox.refresh('user-a')).toEqual([]); expect(h.storage.getItem(sourceKey)).toBe(raw);
      expect(await h.outbox.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      expect(await new h.OutboxStore().refresh('user-a')).toEqual([]); expect(h.storage.getItem(sourceKey)).toBe(raw);
    });
  it.each(['entry record', 'raw', 'nested'].flatMap((kind) => [2, 99].map((version) => [kind, version] as const)))(
    'scoped archive %s version=%s introduced during token acquisition yields zero network fetches', async (kind, version) => {
      const h = await harness(true); const replay = h.replay(); await h.paused.promise;
      const b = { ...h.operation, id: 'disputed-b', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      const key = 'pharmacystock:outbox:v2:key-value-state';
      const raw = JSON.stringify({ version, ownerId: 'user-a', operations: [], vaults: {}, quarantine: [{ ownerId: 'user-a', ...quarantineFields(kind, b) }] });
      h.storage.setItem(key, raw); h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
      expect(await h.outbox.refresh('user-a')).toEqual([]); expect(h.storage.getItem(key)).toBe(raw);
    });
  it.each([false, true].flatMap((indexed) => ['string', 'number', 'object', 'records object'].map((kind) => [indexed, kind] as const)))(
    'indexed=%s %s quarantine garbage permits unrelated imported C through real SDK with durable history', async (indexed, kind) => {
      const h = await harness(indexed); await h.outbox.clear();
      const garbage = kind === 'string' ? 'unidentifiable quarantine garbage' : kind === 'number' ? 42
        : kind === 'object' ? { opaque: true } : { ownerId: 'user-a', records: { opaque: true } };
      await installPersistedQuarantine(h, {}, { value: garbage });
      const c = sale('unrelated'); const raw = JSON.stringify({ operations: [c] });
      expect(await h.outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
      const replay = h.replay(); await h.paused.promise; h.resumed.resolve();
      expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe(c.idempotencyKey);
      if (!indexed) expect(JSON.parse(h.storage.getItem('pharmacystock:outbox:v2:key-value-state')!).quarantine).toEqual(garbage);
      await h.outbox.removeSynced(); const restart = new h.OutboxStore();
      expect(await restart.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
      expect(await restart.refresh('user-a')).toEqual([]);
    });
  it.each([false, true])('indexed=%s nested disputed A skips while unrelated C submits once', async (indexed) => {
    const h = await harness(indexed); await h.outbox.enqueue(sale('unrelated'), 'user-a');
    const replay = h.replay(); await h.paused.promise;
    await installPersistedQuarantine(h, quarantineFields('nested', h.operation));
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
  });
  it('legacy retained raw quarantine traversal exhaustion also skips at the real SDK boundary', async () => {
    const h = await harness(true); const replay = h.replay(); await h.paused.promise;
    let evidence: unknown = { record: h.operation }; for (let depth = 0; depth < 70; depth++) evidence = { record: evidence };
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = h.factory!.open('pharmacystock:outbox:v2', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      tx.objectStore('metadata').put({ key: 'legacy-session-vault-v1:quarantine:user-a', raw: JSON.stringify(evidence) });
    }); } finally { db.close(); }
    h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])('indexed=%s exhausted quarantine extraction skips pre-dispatch without false failures', async (indexed) => {
    const h = await harness(indexed); const replay = h.replay(); await h.paused.promise;
    let nested: unknown = { record: h.operation };
    for (let depth = 0; depth < 70; depth++) nested = { record: nested };
    await installPersistedQuarantine(h, { records: nested });
    h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(['invalid version', 'invalid owner', 'quarantine records object', 'quarantine nested', 'quarantine root', 'receipt header'])(
    '%s appearing during SDK token acquisition blocks its key without a prior recovery pass', async (shape) => {
      const h = await harness(true); const replay = h.replay(); await h.paused.promise;
      const b = { ...h.operation, id: 'conflicting-b', payload: { ...h.operation.payload as object, saleNumber: 'B' } };
      const base = { version: 2, ownerId: 'user-a', operations: [], vaults: {} };
      const quarantine = { ownerId: 'user-a', records: shape === 'quarantine nested'
        ? [{ record: { records: { record: b } }, reason: 'IMMUTABLE_CONFLICT' }] : { record: b, reason: 'IMMUTABLE_CONFLICT' } };
      const wrapper = shape === 'invalid version' ? { ...base, version: 99, operations: [b] }
        : shape === 'invalid owner' ? { ...base, ownerId: 123, vaults: { 'user-a': [b] } }
        : shape === 'receipt header' ? { ...base, version: 99, legacyGlobalRecovery: { ownerId: 'user-a', raw: JSON.stringify({ version: 1, operations: [b] }) } }
        : { ...base, quarantine: shape === 'quarantine root' ? quarantine : [quarantine] };
      const key = 'pharmacystock:outbox:v2:key-value-state'; const raw = JSON.stringify(wrapper); h.storage.setItem(key, raw);
      h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
      expect(await h.outbox.refresh('user-a')).toEqual([]); expect(h.storage.getItem(key)).toBe(raw);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      expect(await new h.OutboxStore().refresh('user-a')).toEqual([]); expect(h.storage.getItem(key)).toBe(raw);
    });
  it('late malformed keyed wrapper skips A while unrelated C continues through the real SDK', async () => {
    const h = await harness(true); await h.outbox.enqueue(sale('unrelated'), 'user-a');
    const replay = h.replay(); await h.paused.promise;
    const raw = JSON.stringify({ version: 99, ownerId: 'user-a', operations: [h.operation], vaults: {} });
    const key = 'pharmacystock:outbox:v2:key-value-state'; h.storage.setItem(key, raw);
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
    expect(h.storage.getItem(key)).toBe(raw);
  });
  it.each(['root', 'quarantine', 'other owner', 'identical'])(
    '%s archive evidence during SDK acquisition allows unrelated/identical authoritative intent exactly once', async (shape) => {
      const h = await harness(true); const replay = h.replay(); await h.paused.promise;
      const wrapper = shape === 'root' ? 'unidentifiable garbage' : shape === 'other owner'
        ? { version: 99, ownerId: 123, vaults: { 'user-d': [{ ...h.operation, payload: { ...h.operation.payload as object, saleNumber: 'B' } }] } }
        : { version: 2, ownerId: 'user-a', operations: shape === 'identical' ? [h.operation] : [], vaults: {}, quarantine: 'garbage' };
      const key = 'pharmacystock:outbox:v2:key-value-state'; const raw = JSON.stringify(wrapper); h.storage.setItem(key, raw);
      h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(h.storage.getItem(key)).toBe(raw);
    });
  it('native unrelated C with a retained receipt-root garbage imports and dispatches through real SDK', async () => {
    const h = await harness(false); await h.outbox.clear();
    const key = 'pharmacystock:outbox:v2:key-value-state'; const state = JSON.parse(h.storage.getItem(key)!);
    h.storage.setItem(key, JSON.stringify({ ...state, legacyVaultReceipts: 'unidentifiable receipt garbage' }));
    const c = sale('unrelated'); const raw = JSON.stringify({ operations: [c] });
    expect(await h.outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
    const replay = h.replay(); await h.paused.promise; h.resumed.resolve();
    expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(h.storage.getItem(key)!);
    expect(saved.legacyVaultReceiptArchives).toEqual(['unidentifiable receipt garbage']);
    expect(saved.legacyVaultReceipts[JSON.stringify(['user-a', c.idempotencyKey])].importedId).toBe(c.id);
  });

  it.each(['conflict', 'malformed', 'identical'])('retained metadata legacy %s source added during SDK token acquisition participates at dispatch', async (kind) => {
    const h = await harness(true); const replay = h.replay(); await h.paused.promise;
    const intent = kind === 'conflict' ? { ...h.operation, payload: { ...h.operation.payload as object, saleNumber: 'changed' } }
      : kind === 'malformed' ? { ...h.operation, createdAt: 'invalid' } : h.operation;
    const raw = JSON.stringify({ operations: [intent] });
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = h.factory!.open('pharmacystock:outbox:v2', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise<void>((resolve, reject) => { const tx = database.transaction('metadata', 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      tx.objectStore('metadata').put({ key: 'legacy-session-vault-v1:quarantine:user-a', raw, safeToDelete: true });
    }); } finally { database.close(); }
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: kind === 'identical' ? 1 : 0 });
    expect(h.fetch).toHaveBeenCalledTimes(kind === 'identical' ? 1 : 0);
    if (kind !== 'identical') expect(await new h.OutboxStore().refresh('user-a')).toEqual([]);
  });
  it.each(['kv-global', 'kv-user', 'idb-global', 'idb-user'])(
    '%s quarantine during SDK token acquisition never dispatches, retains source and persists', async (path) => {
      const h = await harness(path.startsWith('idb'));
      const replay = h.replay();
      await h.paused.promise;
      expect((await h.outbox.refresh('user-a'))[0]?.status).toBe('SYNCING');
      const conflicting = { ...h.operation, id: 'conflicting', payload: { ...h.operation.payload as object, saleNumber: 'different' } };
      const records = [h.operation, { ...h.operation, id: 'identical' }, conflicting];
      const key = path.endsWith('global') ? globalKey : 'pharmacystock:offline-scope:v1:vault:user-a';
      const raw = JSON.stringify(path.endsWith('global') ? { version: 1, operations: records } : { operations: records });
      h.storage.setItem(key, raw);
      if (path.endsWith('global')) await new h.OutboxStore().ready();
      else expect(await h.outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(false);
      // TOKEN_REFRESHED keeps this generation valid; quarantine must still fence.
      await h.scope.bindUser('user-a');
      h.setSession('user-a', 2);
      h.resumed.resolve();
      expect(await replay).toEqual(zero);
      expect(h.fetch).not.toHaveBeenCalled();
      expect(await h.outbox.refresh('user-a')).toEqual([]);
      expect(h.storage.getItem(key)).toBe(raw);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      const restart = new h.OutboxStore();
      expect(await restart.refresh('user-a')).toEqual([]);
      expect(h.storage.getItem(key)).toBe(raw);
    },
  );

  it.each([false, true].flatMap((indexed) => ['remove', 'replace', 'status', 'attempt'].map((mutation) => [indexed, mutation] as const)))('indexed=%s %s during token acquisition rejects stale work and permits unrelated work', async (indexed, mutation) => {
      const h = await harness(indexed);
      await h.outbox.enqueue(sale('unrelated'), 'user-a');
      const replay = h.replay(); await h.paused.promise;
      if (mutation === 'remove') await h.outbox.replaceAll([sale('unrelated')]);
      if (mutation === 'replace') await h.outbox.update(h.operation.id, { payload: { ...h.operation.payload as object, saleNumber: 'replacement' } }, 'user-a');
      if (mutation === 'status') await h.outbox.update(h.operation.id, { status: 'CONFLICT' }, 'user-a');
      if (mutation === 'attempt') await h.outbox.update(h.operation.id, { attemptCount: 99 }, 'user-a');
      const rejected = (await h.outbox.refresh('user-a')).find((item) => item.id === h.operation.id);
      h.resumed.resolve();
      expect(await replay).toEqual({ ...zero, synced: 1 });
      expect((await h.outbox.refresh('user-a')).find((item) => item.id === h.operation.id)).toEqual(rejected);
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
  });

  it.each([false, true].flatMap((indexed) => ['a-b', 'a-b-a', 'unnotified', 'jwt-owner'].map((transition) => [indexed, transition] as const)))('indexed=%s %s fences owner, generation and token before dispatch', async (indexed, transition) => {
      const h = await harness(indexed); const replay = h.replay(); await h.paused.promise;
      if (transition === 'a-b' || transition === 'a-b-a') {
        await h.scope.bindUser('user-b'); h.setSession('user-b');
        if (transition === 'a-b-a') { await h.scope.bindUser('user-a'); h.setSession('user-a', 2); }
      } else if (transition === 'unnotified') h.setSession('user-b');
      else h.setTokenOwner('user-b');
      h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('adapter indexed=%s allows refreshed A token and exact retry with unchanged key', async (indexed) => {
    const h = await harness(indexed); const replay = h.replay(); await h.paused.promise;
    const generation = h.scope.replayScope().generation;
    h.setSession('user-a', 2); await h.scope.bindUser('user-a');
    expect(h.scope.replayScope().generation).toBe(generation);
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.getSession).toHaveBeenCalledTimes(2); // preparation + one memoized SDK acquisition
    expect(new Headers(h.fetch.mock.calls[0]![1]!.headers).get('Authorization')).toBe(`Bearer ${token('user-a', 2)}`);
    expect(await h.replay()).toEqual(zero);
    await h.outbox.update(h.operation.id, { status: 'PENDING' }, 'user-a');
    expect(await h.replay()).toEqual({ ...zero, synced: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.fetch.mock.calls.map(([, init]) => JSON.parse(init!.body as string).p_idempotency_key)).toEqual(['stable-sale-a', 'stable-sale-a']);
  });

  it.each([false, true])('adapter indexed=%s releases storage immediately after fetch, without claiming post-dispatch cancellation', async (indexed) => {
    const h = await harness(indexed); h.delay();
    const replay = h.replay(); await h.paused.promise; h.resumed.resolve(); await h.dispatched.promise;
    const raw = JSON.stringify({ operations: [h.operation, { ...h.operation, id: 'other', payload: { ...h.operation.payload as object, saleNumber: 'conflict' } }] });
    expect(await h.outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(false);
    expect(await h.outbox.refresh('user-a')).toEqual([]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0]![1]?.signal?.aborted).not.toBe(true);
    h.response.resolve(new Response(JSON.stringify('server-sale'), { status: 200 }));
    expect(await replay).toEqual(zero); // A lost durable claim cannot count success.
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('indexed=%s actual SDK TOKEN_REFRESHED during acquisition preserves generation and dispatches once', async (indexed) => {
    const h = await harness(indexed); const generation = h.scope.replayScope().generation;
    const replay = h.replay(); await h.paused.promise;
    const refreshed = await h.source.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(h.refreshEvents).toContain('TOKEN_REFRESHED');
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    h.resumed.resolve();
    expect(await replay).toEqual({ ...zero, synced: 1 });
    expect(h.scope.replayScope().generation).toBe(generation);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(h.fetch.mock.calls[0]![1]!.headers).get('Authorization')).toBe(`Bearer ${token('user-a', 3)}`);
  });

  it.each([false, true])('indexed=%s a user switch after dispatch cannot cancel or reuse the request', async (indexed) => {
    const h = await harness(indexed); h.delay();
    const replay = h.replay(); await h.paused.promise; h.resumed.resolve(); await h.dispatched.promise;
    await h.scope.bindUser('user-b'); h.setSession('user-b');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(h.fetch.mock.calls[0]![1]!.headers).get('Authorization')).toBe(`Bearer ${token('user-a')}`);
    expect(h.fetch.mock.calls[0]![1]?.signal?.aborted).not.toBe(true);
    h.response.resolve(new Response(JSON.stringify('server-sale'), { status: 200 }));
    expect(await replay).toEqual(zero);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true].flatMap((indexed) => ['quarantine', 'owner'].map((mutation) => [indexed, mutation] as const)))('indexed=%s %s after token acquisition but before storage guard wins over dispatch', async (indexed, mutation) => {
    const h = await harness(indexed);
    const entered = deferred<void>(); const released = deferred<void>();
    const guard = h.outbox.dispatchIfAuthoritative.bind(h.outbox);
    vi.spyOn(h.outbox, 'dispatchIfAuthoritative').mockImplementationOnce(async (...args) => {
      entered.resolve(); await released.promise; return guard(...args);
    });
    const replay = h.replay(); await h.paused.promise; h.resumed.resolve(); await entered.promise;
    if (mutation === 'owner') await h.scope.bindUser('user-b');
    else {
      const raw = JSON.stringify({ operations: [h.operation, { ...h.operation, id: 'conflicting', payload: { ...h.operation.payload as object, saleNumber: 'different' } }] });
      expect(await h.outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(false);
    }
    released.resolve();
    expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('indexed=%s ordinary RPC and network errors retain existing retry semantics', async (indexed) => {
    const h = await harness(indexed);
    h.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const replay = h.replay(); await h.paused.promise; h.resumed.resolve();
    expect(await replay).toEqual({ ...zero, failed: 1 });
    expect((await h.outbox.refresh('user-a'))[0]).toMatchObject({ status: 'FAILED', idempotencyKey: h.operation.idempotencyKey });
    await h.outbox.update(h.operation.id, { status: 'PENDING', nextAttemptAt: undefined }, 'user-a');
    h.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'server temporarily unavailable', code: 'XX000', details: null, hint: null }), { status: 500 }));
    expect(await h.replay()).toEqual({ ...zero, failed: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('indexed=%s cancellation predicate during token acquisition skips without failure or state repair', async (indexed) => {
    const h = await harness(indexed); let permitted = true;
    const replay = h.replay(() => permitted); await h.paused.promise;
    const claimed = await h.outbox.refresh('user-a');
    permitted = false; h.resumed.resolve();
    expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
    expect(await h.outbox.refresh('user-a')).toEqual(claimed);
  });

  it('native key/value with a window alias and without atob still dispatches safely', async () => {
    const h = await harness(false); vi.stubGlobal('window', globalThis);
    const replay = h.replay(); await h.paused.promise;
    vi.stubGlobal('atob', undefined);
    h.resumed.resolve();
    expect(await replay).toEqual({ ...zero, synced: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('a late conflicting v2 archive during token acquisition is fenced before the IndexedDB handoff runs', async () => {
    const h = await harness(true); const replay = h.replay(); await h.paused.promise;
    const conflicting = { ...h.operation, id: 'conflicting', payload: { ...h.operation.payload as object, saleNumber: 'other' } };
    const raw = JSON.stringify({ version: 2, ownerId: 'user-a', operations: [h.operation, conflicting], vaults: {} });
    h.storage.setItem('pharmacystock:outbox:v2:key-value-state', raw);
    h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
    expect(await h.outbox.refresh('user-a')).toEqual([]);
    expect(h.storage.getItem('pharmacystock:outbox:v2:key-value-state')).toBe(raw);
  });

  it('browser v2 blocked work hands off to the selected IndexedDB adapter and dispatches once through the real SDK', async () => {
    const h = await harness(false); vi.stubGlobal('document', {});
    const blocked = h.replay(); await h.paused.promise; h.resumed.resolve();
    expect(await blocked).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
    vi.stubGlobal('indexedDB', new IDBFactory());
    const supported = new h.OutboxStore();
    expect((await supported.refresh('user-a'))[0]).toMatchObject({ id: 'sale-a', status: 'PENDING', idempotencyKey: 'stable-sale-a' });
    expect(await h.replaySelected(supported)).toEqual({ ...zero, synced: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await supported.removeSynced();
    expect(await new h.OutboxStore().refresh('user-a')).toEqual([]);
    expect(h.storage.getItem('pharmacystock:outbox:v2:key-value-state')).not.toBeNull();
  });

  it.each(['global', 'user', 'handoff', 'kv'].flatMap((path) => [false, true].map((malformed) => [path, malformed] as const)))(
    '%s malformed=%s late historical receipt fences real SDK dispatch and survives restart/A-B-A', async (path, malformed) => {
      const h = await harness(path !== 'kv'); const replay = h.replay(); await h.paused.promise;
      const intent = malformed ? h.operation : { ...h.operation, id: 'historical-a', payload: { ...h.operation.payload as object, saleNumber: 'historical-other' } };
      const receipt = await installReceipt(h, path, intent, malformed);
      h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
      expect(await h.outbox.refresh('user-a')).toEqual([]);
      await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
      expect(await new h.OutboxStore().refresh('user-a')).toEqual([]);
      if (path === 'kv') expect(JSON.parse(h.storage.getItem('pharmacystock:outbox:v2:key-value-state')!).legacyGlobalRecovery).toEqual(receipt);
    },
  );

  it.each(['global', 'user', 'handoff', 'kv'])('%s valid identical historical evidence still permits exactly one real SDK fetch', async (path) => {
    const h = await harness(path !== 'kv'); const replay = h.replay(); await h.paused.promise;
    await installReceipt(h, path, h.operation, false);
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe(h.operation.idempotencyKey);
  });

  it.each(['kv', 'user'])('%s malformed keyed receipt skips disputed work while unrelated real SDK replay continues', async (path) => {
    const h = await harness(path !== 'kv'); await h.outbox.enqueue(sale('unrelated'), 'user-a');
    const replay = h.replay(); await h.paused.promise; await installReceipt(h, path, h.operation, true);
    h.resumed.resolve(); expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
    expect((await h.outbox.refresh('user-a')).some((item) => item.id === h.operation.id)).toBe(false);
  });

  it.each(['global', 'user'].flatMap((path) => ['conflict', 'malformed', 'identical'].map((mutation) => [path, mutation] as const)))(
    'live %s v1 %s during SDK token acquisition is classified without any import/refresh pass', async (path, mutation) => {
      const h = await harness(true); const replay = h.replay(); await h.paused.promise;
      const changed = mutation === 'conflict' ? { ...h.operation, id: 'late-b', payload: { ...h.operation.payload as object, saleNumber: 'late-b' } }
        : mutation === 'malformed' ? { ...h.operation, id: 'malformed', createdAt: 'invalid' } : h.operation;
      const key = path === 'global' ? globalKey : 'pharmacystock:offline-scope:v1:vault:user-a';
      const raw = JSON.stringify({ ...(path === 'global' ? { version: 1 } : {}), operations: [changed] });
      h.storage.setItem(key, raw); // Deliberately no recovery/import/refresh before resume.
      h.resumed.resolve();
      if (mutation === 'identical') {
        expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe(h.operation.idempotencyKey);
      } else {
        expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
        expect(await h.outbox.refresh('user-a')).toEqual([]);
        expect(h.storage.getItem(key)).toBe(raw);
        await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
        expect(await new h.OutboxStore().refresh('user-a')).toEqual([]); expect(h.storage.getItem(key)).toBe(raw);
      }
    },
  );

  it('a late global v1 dispute skips its key while unrelated real SDK work proceeds', async () => {
    const h = await harness(true); await h.outbox.enqueue(sale('unrelated'), 'user-a');
    const replay = h.replay(); await h.paused.promise;
    const raw = JSON.stringify({ version: 1, operations: [{ ...h.operation, payload: { ...h.operation.payload as object, saleNumber: 'other' } }] });
    h.storage.setItem(globalKey, raw); h.resumed.resolve();
    expect(await replay).toEqual({ ...zero, synced: 1 }); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).p_idempotency_key).toBe('stable-unrelated');
    expect(h.storage.getItem(globalKey)).toBe(raw);
  });

  it('native per-user receipt survives real SDK sync/removal and rejects both resurrection and conflicting replay', async () => {
    const h = await harness(false); const key = 'pharmacystock:offline-scope:v1:vault:user-a';
    const original = JSON.stringify({ operations: [h.operation] }); h.storage.setItem(key, original);
    expect(await h.outbox.importLegacyVault('user-a', original, { ownershipProven: true })).toBe(true);
    expect(await h.outbox.cleanupLegacyVault('user-a', original, 'user-a')).toBe(true);
    const replay = h.replay(); await h.paused.promise; h.resumed.resolve();
    expect(await replay).toEqual({ ...zero, synced: 1 }); await h.outbox.removeSynced(); h.fetch.mockClear();
    const restart = new h.OutboxStore(); await restart.ready();
    expect(await restart.importLegacyVault('user-a', original, { ownershipProven: true })).toBe(true);
    expect(await restart.refresh('user-a')).toEqual([]); expect(await h.replaySelected(restart)).toEqual(zero);
    const replacement = JSON.stringify({ operations: [{ ...h.operation, id: 'late-b', payload: { ...h.operation.payload as object, saleNumber: 'other' } }] });
    h.storage.setItem(key, replacement);
    expect(await restart.importLegacyVault('user-a', replacement, { ownershipProven: true })).toBe(false);
    expect(await h.replaySelected(restart)).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.storage.getItem(key)).toBe(replacement);
    await h.scope.bindUser('user-b'); await h.scope.bindUser('user-a');
    expect(await new h.OutboxStore().refresh('user-a')).toEqual([]);
    expect(JSON.parse(h.storage.getItem('pharmacystock:outbox:v2:key-value-state')!).legacyVaultReceipts).toBeTruthy();
  });

  it('late native per-user historical receipt is honored at the real SDK dispatch boundary', async () => {
    const h = await harness(false); const replay = h.replay(); await h.paused.promise;
    const rootKey = 'pharmacystock:outbox:v2:key-value-state'; const state = JSON.parse(h.storage.getItem(rootKey)!);
    const encoded = JSON.stringify(['user-a', h.operation.idempotencyKey]);
    const receipt = { key: `legacy-session-vault-v1:import:${encoded}`, importedId: 'historical-a',
      sourceFingerprint: JSON.stringify({ ...h.operation, id: 'historical-a', payload: { ...h.operation.payload as object, saleNumber: 'historical-other' } }) };
    h.storage.setItem(rootKey, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: receipt } }));
    h.resumed.resolve(); expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
    expect(await h.outbox.refresh('user-a')).toEqual([]);
    expect(JSON.parse(h.storage.getItem(rootKey)!).legacyVaultReceipts[encoded]).toEqual(receipt);
  });

  it('browser key/value fallback fails closed and does not retry immediately', async () => {
    const h = await harness(false); vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const replay = h.replay(); await h.paused.promise; h.resumed.resolve();
    expect(await replay).toEqual(zero); expect(h.fetch).not.toHaveBeenCalled();
    expect((await h.outbox.refresh('user-a'))[0]?.status).toBe('SYNCING');
    expect(await h.replay()).toEqual(zero);
    expect(h.outbox.pending()).toEqual([]);
  });
});
