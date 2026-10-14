import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import type { KeyValueStorage } from './storage';
import { ReplayPreparationError, SyncCoordinator } from './sync';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
const now = new Date('2026-10-04T12:00:00.000Z');
const empty = { synced: 0, conflicts: 0, failed: 0 };
const operation: OutboxOperation = {
  id: 'sale-a', idempotencyKey: 'stable-sale-a', kind: 'SALE',
  organizationId: 'org-a', branchId: 'branch-a', payload: { saleNumber: 'A' },
  createdAt: '2026-10-04T11:00:00.000Z', status: 'PENDING', attemptCount: 0,
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
for (const adapter of ['kv', 'idb'] as const) {
  describe(adapter + ' authoritative replay membership', () => {
    async function setup() {
      vi.stubGlobal('navigator', {});
      const storage = memoryStorage();
      const factory = adapter === 'idb' ? new IDBFactory() : undefined;
      const outbox = new OutboxStore(storage, { indexedDB: factory });
      await outbox.transitionOwner(null, 'user-a');
      await outbox.enqueue(operation, 'user-a');
      const submit = vi.fn(async (_operation: OutboxOperation) => ({ status: 'SYNCED' as const, serverId: 'server-sale' }));
      return { outbox, submit };
    }

    const changes: { name: string; mutate: (outbox: OutboxStore) => Promise<unknown> }[] = [
      { name: 'removed', mutate: (box) => box.clear() },
      { name: 'immutable content replaced', mutate: (box) => box.update(operation.id, { payload: { saleNumber: 'B' } }, 'user-a') },
      { name: 'idempotency replaced', mutate: (box) => box.replaceAll([{ ...operation, idempotencyKey: 'other-key' }]) },
      { name: 'timestamp identity replaced', mutate: (box) => box.replaceAll([{ ...operation, createdAt: '2026-10-04T11:01:00.000Z' }]) },
      { name: 'synced', mutate: (box) => box.update(operation.id, { status: 'SYNCED' }, 'user-a') },
      { name: 'conflicted', mutate: (box) => box.update(operation.id, { status: 'CONFLICT' }, 'user-a') },
      { name: 'future retry', mutate: (box) => box.update(operation.id, { status: 'FAILED', nextAttemptAt: '2026-10-04T12:02:00.000Z' }, 'user-a') },
      { name: 'another syncing attempt', mutate: (box) => box.update(operation.id, { status: 'SYNCING', attemptCount: 2, lastAttemptAt: now.toISOString() }, 'user-a') },
      { name: 'malformed/quarantined', mutate: (box) => box.replaceAll([{ ...operation, idempotencyKey: '' }]) },
      { name: 'owner changed', mutate: (box) => box.transitionOwner('user-a', 'user-b') },
    ];
    it.each(changes)('does not submit a captured intent that becomes $name during preparation', async ({ mutate }) => {
      const { outbox, submit } = await setup();
      let afterMutation: OutboxOperation[] = [];
      const coordinator = new SyncCoordinator(outbox, { SALE: submit }, {
        expectedOwnerId: 'user-a', now: () => now,
        beforeReplay: async () => { await mutate(outbox); afterMutation = await outbox.refresh(); },
      });
      expect(await coordinator.replayPending()).toEqual(empty);
      expect(submit).not.toHaveBeenCalled();
      expect(await outbox.refresh()).toEqual(afterMutation);
    });

    it.each(['null', 'no-op'] as const)('fails closed on a %s SYNCING update', async (result) => {
      const { outbox, submit } = await setup();
      vi.spyOn(outbox, 'update').mockResolvedValueOnce(result === 'null' ? null : operation);
      expect(await new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now }).replayPending()).toEqual(empty);
      expect(submit).not.toHaveBeenCalled();
      expect(outbox.list()).toEqual([operation]);
    });

    it('compares the captured record inside the durable claim, without mutating a concurrent replacement', async () => {
      const { outbox, submit } = await setup();
      const update = outbox.update.bind(outbox);
      vi.spyOn(outbox, 'update').mockImplementation(async (...args) => {
        if (args[1].status === 'SYNCING') await update(operation.id, { payload: { saleNumber: 'B' } }, 'user-a');
        return update(...args);
      });
      expect(await new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now }).replayPending()).toEqual(empty);
      expect(submit).not.toHaveBeenCalled();
      expect(outbox.list()).toEqual([{ ...operation, payload: { saleNumber: 'B' } }]);
    });

    it.each(['CONFLICT', 'FAILED', 'SYNCED'] as const)('does not dispatch after a committed claim moves to %s', async (status) => {
      const { outbox, submit } = await setup();
      const update = outbox.update.bind(outbox);
      vi.spyOn(outbox, 'update').mockImplementation(async (...args) => {
        const claimed = await update(...args);
        if (args[1].status === 'SYNCING') await update(operation.id, { status }, 'user-a');
        return claimed;
      });
      expect(await new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now }).replayPending()).toEqual(empty);
      expect(submit).not.toHaveBeenCalled();
      expect(outbox.list()[0]?.status).toBe(status);
    });

    it('captures the durable owner when omitted and rejects identical work restored under another owner', async () => {
      const { outbox, submit } = await setup();
      expect(await new SyncCoordinator(outbox, { SALE: submit }, {
        now: () => now,
        beforeReplay: async () => {
          await outbox.transitionOwner('user-a', 'user-b');
          await outbox.enqueue(operation, 'user-b');
        },
      }).replayPending()).toEqual(empty);
      expect(submit).not.toHaveBeenCalled();
      expect(await outbox.refresh('user-b')).toEqual([operation]);
    });

    it('skips a removed captured intent and still submits unrelated valid work', async () => {
      const { outbox, submit } = await setup();
      const unrelated = { ...operation, id: 'sale-b', idempotencyKey: 'stable-b' };
      await outbox.enqueue(unrelated, 'user-a');
      expect(await new SyncCoordinator(outbox, { SALE: submit }, {
        expectedOwnerId: 'user-a', now: () => now,
        beforeReplay: () => outbox.replaceAll([unrelated]),
      }).replayPending()).toEqual({ ...empty, synced: 1 });
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: unrelated.id, idempotencyKey: unrelated.idempotencyKey, status: 'SYNCING' }));
      expect(outbox.list()).toEqual([expect.objectContaining({ id: unrelated.id, status: 'SYNCED' })]);
    });

    it.each([false, true])('counts only authoritative preparation-error updates; retryable=%s', async (retryable) => {
      const { outbox, submit } = await setup();
      const unrelated = { ...operation, id: 'sale-b', idempotencyKey: 'stable-b' };
      await outbox.enqueue(unrelated, 'user-a');
      expect(await new SyncCoordinator(outbox, { SALE: submit }, {
        expectedOwnerId: 'user-a', now: () => now,
        beforeReplay: async () => {
          await outbox.replaceAll([unrelated]);
          throw new ReplayPreparationError('AUTH_OR_NETWORK', retryable);
        },
      }).replayPending()).toEqual(retryable ? { ...empty, failed: 1 } : { ...empty, conflicts: 1 });
      expect(submit).not.toHaveBeenCalled();
      expect(outbox.list()[0]).toMatchObject({ id: unrelated.id, status: retryable ? 'FAILED' : 'CONFLICT', attemptCount: 1 });
    });

    it('keeps normal exact retry identity and exponential backoff for authoritative work', async () => {
      const { outbox, submit } = await setup();
      let clock = now;
      const retrySubmit = vi.fn(async (current: OutboxOperation) => {
        expect(current).toMatchObject({ status: 'SYNCING', idempotencyKey: operation.idempotencyKey });
        return retrySubmit.mock.calls.length === 1
          ? { status: 'FAILED' as const, retryable: true, errorCode: 'NETWORK' }
          : submit(current);
      });
      const coordinator = new SyncCoordinator(outbox, { SALE: retrySubmit }, { expectedOwnerId: 'user-a', now: () => clock });
      expect(await coordinator.replayPending()).toEqual({ ...empty, failed: 1 });
      expect(await coordinator.replayPending()).toEqual(empty);
      expect(retrySubmit).toHaveBeenCalledTimes(1);
      clock = new Date(now.getTime() + 2_000);
      expect(await coordinator.replayPending()).toEqual({ ...empty, synced: 1 });
      expect(outbox.list()[0]).toMatchObject({ id: operation.id, idempotencyKey: operation.idempotencyKey, status: 'SYNCED', attemptCount: 2 });
    });

    it('does not overwrite or count a removed intent after an already-dispatched RPC resolves', async () => {
      const { outbox } = await setup();
      const submit = vi.fn(async () => { await outbox.clear(); return { status: 'SYNCED' as const }; });
      expect(await new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now }).replayPending()).toEqual(empty);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(await outbox.refresh('user-a')).toEqual([]);
    });

    it('fails closed if the final authoritative durable read fails', async () => {
      const { outbox, submit } = await setup();
      const refresh = outbox.refresh.bind(outbox);
      vi.spyOn(outbox, 'refresh').mockImplementation(async (owner) => {
        if (outbox.list()[0]?.status === 'SYNCING') throw new Error('STORAGE_UNAVAILABLE');
        return refresh(owner);
      });
      await expect(new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now }).replayPending()).rejects.toThrow('STORAGE_UNAVAILABLE');
      expect(submit).not.toHaveBeenCalled();
      expect(outbox.list()[0]?.status).toBe('SYNCING');
    });
  });
}
