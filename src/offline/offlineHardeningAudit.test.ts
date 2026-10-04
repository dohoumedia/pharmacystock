import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { OutboxStore, outboxReplayEligibleAt, type OutboxOperation, type OutboxStoreOptions } from './outbox';
import { nextOutboxReplayAt } from './replayScheduler';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';
import { SyncCoordinator } from './sync';

const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a';
const ownerKey = 'pharmacystock:offline-scope:v1:user-id';
const stateKey = 'pharmacystock:outbox:v2:key-value-state';
const now = new Date('2026-10-04T12:00:00.000Z');

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function operation(id = 'sale-a'): OutboxOperation {
  return {
    id, kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
    idempotencyKey: `stable-${id}`, payload: { saleNumber: id },
    createdAt: '2026-10-04T11:00:00.000Z', status: 'PENDING', attemptCount: 0,
  };
}

function optionsFor(adapter: string): OutboxStoreOptions {
  return adapter === 'indexeddb'
    ? { indexedDB: new IDBFactory(), databaseName: 'offline-medium-audit' }
    : {};
}

// Expected safety assertions intentionally fail on the unmodified PR #88 base.
// No production code is changed by this investigation.
describe('MEDIUM audit: key/value legacy envelope validation', () => {
  it('does not activate a legacy record missing idempotencyKey', async () => {
    const storage = memoryStorage();
    const malformed: Partial<OutboxOperation> = operation();
    delete malformed.idempotencyKey;
    const raw = JSON.stringify({ operations: [malformed] });
    storage.setItem(vaultKey, raw);
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.refresh('user-a');
    expect.soft(outbox.list()).toEqual([]);
    expect.soft(outbox.pending(now)).toEqual([]);
    expect.soft(storage.getItem(vaultKey)).toBe(raw);
  });

  it('retains the exact malformed legacy source after recovery is attempted', async () => {
    const storage = memoryStorage();
    const malformed: Partial<OutboxOperation> = operation();
    delete malformed.idempotencyKey;
    const raw = JSON.stringify({ operations: [malformed] });
    storage.setItem(vaultKey, raw);
    await new OfflineSessionScope(storage).bindUser('user-a');
    expect(storage.getItem(vaultKey)).toBe(raw);
  });

  it.each(['id', 'kind', 'organizationId', 'status', 'payload', 'createdAt', 'attemptCount'] as const)(
    'rejects an envelope missing %s before recovery', async (field) => {
      const storage = memoryStorage();
      const malformed: Partial<OutboxOperation> = operation();
      delete malformed[field];
      const raw = JSON.stringify({ operations: [malformed] });
      storage.setItem(vaultKey, raw);
      await new OfflineSessionScope(storage).bindUser('user-a');
      const outbox = new OutboxStore(storage);
      await outbox.refresh('user-a');
      expect.soft(outbox.list()).toEqual([]);
      expect.soft(storage.getItem(vaultKey)).toBe(raw);
    },
  );

  it('retains a mixed valid/malformed source and does not partially recover it', async () => {
    const storage = memoryStorage();
    const malformed: Partial<OutboxOperation> = operation('malformed');
    delete malformed.idempotencyKey;
    const raw = JSON.stringify({ operations: [operation(), malformed] });
    storage.setItem(vaultKey, raw);
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.refresh('user-a');
    expect.soft(outbox.list()).toEqual([]);
    expect.soft(storage.getItem(vaultKey)).toBe(raw);
  });
});

for (const adapter of ['key-value', 'indexeddb']) {
  describe(`MEDIUM audit: ${adapter} owner restoration`, () => {
    it.each([undefined, 'not-a-date', '', 0, null, {}])(
      'keeps SYNCING lastAttemptAt=%j fail-closed after A -> B -> A', async (lastAttemptAt) => {
        const storage = memoryStorage();
        const options = optionsFor(adapter);
        const scope = new OfflineSessionScope(storage, options);
        const outbox = new OutboxStore(storage, options);
        await scope.bindUser('user-a');
        await outbox.enqueue(operation(), 'user-a');
        await outbox.update('sale-a', {
          status: 'SYNCING', attemptCount: 1, lastAttemptAt: lastAttemptAt as string | undefined,
        }, 'user-a');
        const original = outbox.list()[0]!;
        expect(outboxReplayEligibleAt(original)).toBeNull();
        expect(outbox.pending(now)).toEqual([]);
        expect(nextOutboxReplayAt(outbox.list(), now)).toBeNull();

        await scope.bindUser('user-b');
        await outbox.refresh('user-b');
        expect(outbox.list()).toEqual([]);
        await expect(outbox.refresh('user-a')).rejects.toMatchObject({ message: 'OUTBOX_OWNER_CHANGED' });
        expect(outbox.list()).toEqual([]);
        await scope.bindUser('user-a');
        await outbox.refresh('user-a');

        expect.soft(outbox.list()[0]).toMatchObject({ id: original.id, idempotencyKey: original.idempotencyKey });
        expect.soft(outbox.list()[0]?.status).toBe('SYNCING');
        expect.soft(outbox.pending(now)).toEqual([]);
        expect.soft(nextOutboxReplayAt(outbox.list(), now)).toBeNull();
        const submit = vi.fn(async () => ({ status: 'SYNCED' as const }));
        await new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now }).replayPending();
        expect.soft(submit).not.toHaveBeenCalled();
      },
    );

    it('restores valid interrupted SYNCING with unchanged identity and replays once', async () => {
      const storage = memoryStorage();
      const options = optionsFor(adapter);
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      await scope.bindUser('user-a');
      await outbox.enqueue(operation(), 'user-a');
      await outbox.update('sale-a', {
        status: 'SYNCING', attemptCount: 1, lastAttemptAt: '2026-10-04T11:58:00.000Z',
        nextAttemptAt: '2026-10-04T12:05:00.000Z', lastErrorCode: 'NETWORK',
      }, 'user-a');
      await scope.bindUser('user-b');
      await outbox.refresh('user-b');
      expect(outbox.list()).toEqual([]);
      await scope.bindUser('user-a');
      await outbox.refresh('user-a');
      expect(outbox.list()[0]).toMatchObject({ id: 'sale-a', idempotencyKey: 'stable-sale-a', status: 'PENDING', attemptCount: 1 });
      expect(outbox.list()[0]?.nextAttemptAt).toBeUndefined();
      const submit = vi.fn(async () => ({ status: 'SYNCED' as const }));
      const coordinator = new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now });
      await coordinator.replayPending();
      await coordinator.replayPending();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'stable-sale-a' }));
    });

    it('recovers valid same-user legacy work idempotently after cleanup failure', async () => {
      const base = memoryStorage();
      let failCleanup = true;
      const storage: KeyValueStorage = {
        getItem: (key) => base.getItem(key),
        setItem: (key, value) => base.setItem(key, value),
        removeItem: (key) => {
          if (key === vaultKey && failCleanup) throw new Error('simulated cleanup interruption');
          base.removeItem(key);
        },
      };
      const options = optionsFor(adapter);
      const raw = JSON.stringify({ operations: [operation()] });
      storage.setItem(vaultKey, raw);
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      await scope.bindUser('user-a');
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([operation()]);
      expect(storage.getItem(vaultKey)).toBe(raw);
      failCleanup = false;
      await scope.bindUser('user-a');
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([operation()]);
      expect(storage.getItem(vaultKey)).toBeNull();
    });

    it('leaves foreign legacy work untouched until its user authenticates', async () => {
      const storage = memoryStorage();
      const options = optionsFor(adapter);
      const raw = JSON.stringify({ operations: [operation()] });
      storage.setItem(vaultKey, raw);
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      await scope.bindUser('user-b');
      await outbox.refresh('user-b');
      expect(outbox.list()).toEqual([]);
      expect(storage.getItem(vaultKey)).toBe(raw);
      await scope.bindUser('user-a');
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([operation()]);
      expect(storage.getItem(vaultKey)).toBeNull();
    });

    it('preserves immutable conflicts and their legacy source', async () => {
      const storage = memoryStorage();
      const options = optionsFor(adapter);
      storage.setItem(ownerKey, 'user-a');
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      await scope.bindUser('user-a');
      await outbox.enqueue(operation(), 'user-a');
      const raw = JSON.stringify({ operations: [{ ...operation('different-id'), idempotencyKey: 'stable-sale-a', payload: { total: 999 } }] });
      storage.setItem(vaultKey, raw);
      await scope.bindUser('user-a');
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([operation()]);
      expect(storage.getItem(vaultKey)).toBe(raw);
    });

    it('does not assign ownerless global legacy work to A or B', async () => {
      const storage = memoryStorage();
      const options = optionsFor(adapter);
      storage.setItem('pharmacystock:outbox:v1:operations', JSON.stringify({ version: 1, operations: [operation()] }));
      const scope = new OfflineSessionScope(storage, options);
      const outbox = new OutboxStore(storage, options);
      for (const userId of ['user-a', 'user-b', 'user-a']) {
        await scope.bindUser(userId);
        await outbox.refresh(userId);
        expect(outbox.list()).toEqual([]);
      }
    });
  });
}

describe('MEDIUM audit controls', () => {
  it('IndexedDB rejects missing legacy identity and retains the malformed source', async () => {
    const storage = memoryStorage();
    const options = optionsFor('indexeddb');
    const malformed: Partial<OutboxOperation> = operation();
    delete malformed.idempotencyKey;
    const raw = JSON.stringify({ operations: [malformed] });
    storage.setItem(vaultKey, raw);
    await new OfflineSessionScope(storage, options).bindUser('user-a');
    const outbox = new OutboxStore(storage, options);
    await outbox.refresh('user-a');
    expect(outbox.list()).toEqual([]);
    expect(storage.getItem(vaultKey)).toBe(raw);
  });

  it('key/value retains a valid source when its recovery commit fails, then retries once', async () => {
    const base = memoryStorage();
    let failCommit = true;
    const storage: KeyValueStorage = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (key === stateKey && failCommit) throw new Error('simulated durable commit failure');
        base.setItem(key, value);
      },
      removeItem: (key) => base.removeItem(key),
    };
    const raw = JSON.stringify({ operations: [operation()] });
    storage.setItem(vaultKey, raw);
    const scope = new OfflineSessionScope(storage);
    await expect(scope.bindUser('user-a')).rejects.toThrow('simulated durable commit failure');
    expect(storage.getItem(vaultKey)).toBe(raw);
    failCommit = false;
    await scope.bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.refresh('user-a');
    expect(outbox.list()).toEqual([operation()]);
    expect(storage.getItem(vaultKey)).toBeNull();
  });
});
