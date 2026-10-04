import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation, type OutboxStoreOptions } from './outbox';
import { nextOutboxReplayAt } from './replayScheduler';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';

const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a';
const stateKey = 'pharmacystock:outbox:v2:key-value-state';
const now = new Date('2026-10-04T12:00:00.000Z');

function operation(id = 'sale-a'): OutboxOperation {
  return {
    id, idempotencyKey: `stable-${id}`, kind: 'SALE', status: 'PENDING',
    organizationId: 'org-a', branchId: 'branch-a',
    payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: id },
    createdAt: '2026-10-04T11:00:00.000Z', attemptCount: 0,
  };
}

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function optionsFor(adapter: string): OutboxStoreOptions {
  return adapter === 'indexeddb'
    ? { indexedDB: new IDBFactory(), databaseName: 'offline-recovery-regression' }
    : {};
}

const invalidFields: { name: string; patch: Record<string, unknown> }[] = [
  { name: 'empty idempotencyKey', patch: { idempotencyKey: '' } },
  { name: 'blank idempotencyKey', patch: { idempotencyKey: '  ' } },
  { name: 'numeric idempotencyKey', patch: { idempotencyKey: 123 } },
  { name: 'null idempotencyKey', patch: { idempotencyKey: null } },
  { name: 'empty id', patch: { id: '' } },
  { name: 'blank id', patch: { id: '  ' } },
  { name: 'numeric id', patch: { id: 123 } },
  { name: 'object id', patch: { id: {} } },
  { name: 'unsupported kind', patch: { kind: 'PURCHASE_RECEIPT' } },
  { name: 'numeric kind', patch: { kind: 123 } },
  { name: 'unknown status', patch: { status: 'READY' } },
  { name: 'numeric status', patch: { status: 0 } },
  { name: 'null payload', patch: { payload: null } },
  { name: 'array payload', patch: { payload: [] } },
  { name: 'string payload', patch: { payload: 'sale-a' } },
  { name: 'numeric payload', patch: { payload: 123 } },
  { name: 'invalid createdAt', patch: { createdAt: 'not-a-date' } },
  { name: 'blank createdAt', patch: { createdAt: '' } },
  { name: 'numeric createdAt', patch: { createdAt: 0 } },
  { name: 'null createdAt', patch: { createdAt: null } },
  { name: 'negative attemptCount', patch: { attemptCount: -1 } },
  { name: 'fractional attemptCount', patch: { attemptCount: 0.5 } },
  { name: 'string attemptCount', patch: { attemptCount: '1' } },
  { name: 'null attemptCount', patch: { attemptCount: null } },
  { name: 'unsafe attemptCount', patch: { attemptCount: Number.MAX_SAFE_INTEGER + 1 } },
  { name: 'numeric organizationId', patch: { organizationId: 0 } },
  { name: 'empty organizationId', patch: { organizationId: '' } },
  { name: 'blank organizationId', patch: { organizationId: '  ' } },
  { name: 'null organizationId', patch: { organizationId: null } },
  { name: 'missing SALE branch', patch: { branchId: undefined } },
  { name: 'empty branchId', patch: { branchId: '' } },
  { name: 'blank branchId', patch: { branchId: '  ' } },
  { name: 'numeric branchId', patch: { branchId: 0 } },
  { name: 'null branchId', patch: { branchId: null } },
  { name: 'mismatched payload organization', patch: { payload: { organizationId: 'org-b' } } },
  { name: 'mismatched payload branch', patch: { payload: { branchId: 'branch-b' } } },
  { name: 'null payload organization', patch: { payload: { organizationId: null } } },
  { name: 'invalid lastAttemptAt', patch: { lastAttemptAt: 'not-a-date' } },
  { name: 'empty lastAttemptAt', patch: { lastAttemptAt: '' } },
  { name: 'numeric lastAttemptAt', patch: { lastAttemptAt: 0 } },
  { name: 'null lastAttemptAt', patch: { lastAttemptAt: null } },
  { name: 'SYNCING missing lastAttemptAt', patch: { status: 'SYNCING' } },
  { name: 'SYNCING invalid lastAttemptAt', patch: { status: 'SYNCING', lastAttemptAt: 'not-a-date' } },
  { name: 'invalid nextAttemptAt', patch: { nextAttemptAt: 'not-a-date' } },
  { name: 'empty nextAttemptAt', patch: { nextAttemptAt: '' } },
  { name: 'numeric nextAttemptAt', patch: { nextAttemptAt: 0 } },
  { name: 'null nextAttemptAt', patch: { nextAttemptAt: null } },
  { name: 'FAILED invalid nextAttemptAt', patch: { status: 'FAILED', nextAttemptAt: 'not-a-date' } },
  { name: 'numeric lastErrorCode', patch: { lastErrorCode: 0 } },
  { name: 'numeric serverId', patch: { serverId: 0 } },
];

describe('key/value legacy recovery envelope regressions', () => {
  it.each(invalidFields)('retains $name without writes or source cleanup', async ({ patch }) => {
    const base = memoryStorage();
    const storage = { ...base, setItem: vi.fn(base.setItem), removeItem: vi.fn(base.removeItem) };
    const scope = new OfflineSessionScope(storage);
    await scope.bindUser('user-a');
    const before = storage.getItem(stateKey);
    const raw = JSON.stringify({ operations: [{ ...operation(), ...patch }] });
    storage.setItem(vaultKey, raw);
    storage.setItem.mockClear();
    storage.removeItem.mockClear();

    await scope.bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.refresh('user-a');
    expect(outbox.list()).toEqual([]);
    expect(storage.getItem(vaultKey)).toBe(raw);
    expect(storage.getItem(stateKey)).toBe(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(['null', '{}', '{"operations":{}}', '{"operations":[null]}', '{"operations":[[]]}', '{"operations":["sale"]}', '{broken']) (
    'retains malformed container %s', async (raw) => {
      const storage = memoryStorage();
      storage.setItem(vaultKey, raw);
      await new OfflineSessionScope(storage).bindUser('user-a');
      const outbox = new OutboxStore(storage);
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([]);
      expect(storage.getItem(vaultKey)).toBe(raw);
    },
  );

  it.each([true, false])('rejects mixed validity atomically, malformed first=%s', async (malformedFirst) => {
    const storage = memoryStorage();
    const malformed = { ...operation('bad'), idempotencyKey: '' };
    const operations = malformedFirst ? [malformed, operation()] : [operation(), malformed];
    const raw = JSON.stringify({ operations });
    storage.setItem(vaultKey, raw);
    const scope = new OfflineSessionScope(storage);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await scope.bindUser('user-a');
      const outbox = new OutboxStore(storage);
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([]);
      expect(storage.getItem(vaultKey)).toBe(raw);
    }
  });

  it.each(['PENDING', 'FAILED', 'CONFLICT', 'SYNCED', 'SYNCING'] as const)(
    'accepts the existing %s envelope without imposing a sale-line schema', async (status) => {
      const storage = memoryStorage();
      const source = {
        ...operation(), status, payload: {},
        ...(status === 'SYNCING' ? { lastAttemptAt: '2026-10-04T11:59:00.000Z', attemptCount: 1 } : {}),
      };
      storage.setItem(vaultKey, JSON.stringify({ operations: [source] }));
      await new OfflineSessionScope(storage).bindUser('user-a');
      const outbox = new OutboxStore(storage);
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([status === 'SYNCING' ? { ...source, status: 'PENDING' } : source]);
      expect(storage.getItem(vaultKey)).toBeNull();
    },
  );

  it('retains a late immutable collision without committing earlier valid records', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    await scope.bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.enqueue(operation('existing'), 'user-a');
    const before = storage.getItem(stateKey);
    const collision = { ...operation('z-collision'), idempotencyKey: 'stable-existing', payload: { different: true } };
    const raw = JSON.stringify({ operations: [operation('a-new'), collision] });
    storage.setItem(vaultKey, raw);
    await scope.bindUser('user-a');
    await outbox.refresh('user-a');
    expect(outbox.list()).toEqual([operation('existing')]);
    expect(storage.getItem(stateKey)).toBe(before);
    expect(storage.getItem(vaultKey)).toBe(raw);
  });

  it('retains a reused local id with a distinct replay key instead of inventing identity', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    await scope.bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.enqueue(operation(), 'user-a');
    const raw = JSON.stringify({ operations: [{ ...operation(), idempotencyKey: 'another-key' }] });
    storage.setItem(vaultKey, raw);
    await scope.bindUser('user-a');
    await outbox.refresh('user-a');
    expect(outbox.list()).toEqual([operation()]);
    expect(storage.getItem(vaultKey)).toBe(raw);
  });
});

for (const adapter of ['key-value', 'indexeddb']) {
  describe(`${adapter} recovery cleanup and restart regressions`, () => {
    it('removes a valid source only after the complete recovery has committed', async () => {
      const base = memoryStorage();
      let committed = false;
      const storage: KeyValueStorage = {
        ...base,
        removeItem: (key) => {
          if (key === vaultKey) expect(committed).toBe(true);
          base.removeItem(key);
        },
      };
      const options = optionsFor(adapter);
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      await scope.bindUser('user-a');
      const sources = [operation(), operation('sale-b')];
      storage.setItem(vaultKey, JSON.stringify({ operations: sources }));
      const importVault = OutboxStore.prototype.importLegacyVault;
      const spy = vi.spyOn(OutboxStore.prototype, 'importLegacyVault').mockImplementation(async function (
        this: OutboxStore, ownerId, raw, importOptions,
      ) {
        const complete = await importVault.call(this, ownerId, raw, importOptions);
        expect(complete).toBe(true);
        await outbox.refresh('user-a');
        expect(outbox.list()).toEqual(sources);
        committed = true;
        return complete;
      });
      try {
        await scope.bindUser('user-a');
        expect(committed).toBe(true);
        expect(storage.getItem(vaultKey)).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('retains a source replaced between import and cleanup, then recovers it idempotently', async () => {
      const base = memoryStorage();
      const originalRaw = JSON.stringify({ operations: [operation()] });
      const replacementRaw = JSON.stringify({ operations: [operation(), operation('sale-b')] });
      let reads = 0;
      const storage: KeyValueStorage = {
        ...base,
        getItem: (key) => {
          if (key === vaultKey && ++reads === 2) base.setItem(vaultKey, replacementRaw);
          return base.getItem(key);
        },
      };
      const options = optionsFor(adapter);
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      await scope.bindUser('user-a');
      // Initial bind had no source; count only this recovery's two source reads.
      reads = 0;
      storage.setItem(vaultKey, originalRaw);
      await scope.bindUser('user-a');
      expect(storage.getItem(vaultKey)).toBe(replacementRaw);
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([operation()]);
      await scope.bindUser('user-a');
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([operation(), operation('sale-b')]);
      expect(storage.getItem(vaultKey)).toBeNull();
    });

    it.each([true, false])('restores after restart with valid timing=%s and unchanged identity', async (valid) => {
      const storage = memoryStorage();
      const options = optionsFor(adapter);
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      await scope.bindUser('user-a');
      await outbox.enqueue(operation(), 'user-a');
      await outbox.update('sale-a', {
        status: 'SYNCING', attemptCount: 1,
        lastAttemptAt: valid ? '2026-10-04T11:00:00.000Z' : 'not-a-date',
        lastErrorCode: 'NETWORK',
      }, 'user-a');
      const before = outbox.list()[0];
      await scope.bindUser(null);
      const restartedScope = new OfflineSessionScope(storage, options);
      const restartedOutbox = new OutboxStore(storage, options);
      await restartedScope.bindUser('user-b');
      await restartedOutbox.refresh('user-b');
      expect(restartedOutbox.list()).toEqual([]);
      await restartedScope.bindUser('user-a');
      await restartedOutbox.refresh('user-a');
      if (valid) {
        expect(restartedOutbox.list()[0]).toMatchObject({ id: 'sale-a', idempotencyKey: 'stable-sale-a', status: 'PENDING' });
      } else {
        expect(restartedOutbox.list()).toEqual([before]);
        expect(restartedOutbox.pending(now)).toEqual([]);
        expect(nextOutboxReplayAt(restartedOutbox.list(), now)).toBeNull();
      }
    });

    it.each([undefined, 'not-a-date'])('keeps malformed legacy SYNCING lastAttemptAt=%j non-replayable', async (lastAttemptAt) => {
      const storage = memoryStorage();
      const options = optionsFor(adapter);
      const source = { ...operation(), status: 'SYNCING', attemptCount: 1, lastAttemptAt };
      const raw = JSON.stringify({ operations: [source] });
      storage.setItem(vaultKey, raw);
      await new OfflineSessionScope(storage, options).bindUser('user-a');
      const outbox = new OutboxStore(storage, options);
      await outbox.refresh('user-a');
      expect(outbox.pending(now)).toEqual([]);
      expect(nextOutboxReplayAt(outbox.list(), now)).toBeNull();
      if (adapter === 'key-value') {
        expect(outbox.list()).toEqual([]);
        expect(storage.getItem(vaultKey)).toBe(raw);
      } else {
        // Existing IndexedDB import retains its structurally accepted record;
        // the shared restoration guard must preserve its invalid timing exactly.
        expect(outbox.list()).toEqual([JSON.parse(raw).operations[0]]);
      }
    });
  });
}
