import { describe, expect, it } from 'vitest';
import { OutboxStore } from './outbox';
import { SyncCoordinator } from './sync';
import type { KeyValueStorage } from './storage';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('offline outbox', () => {
  it('persists operations and keeps one operation per idempotency key', () => {
    const storage = memoryStorage();
    const outbox = new OutboxStore(storage);
    const envelope = {
      id: 'local-1',
      kind: 'CUSTOMER_UPDATE',
      organizationId: 'org-1',
      idempotencyKey: 'stable-key-1',
      payload: { fullName: 'Ada' },
      createdAt: '2026-08-23T18:00:00.000Z',
    };

    outbox.enqueue(envelope);
    outbox.enqueue({ ...envelope, id: 'local-2' });

    expect(new OutboxStore(storage).list()).toHaveLength(1);
    expect(new OutboxStore(storage).list()[0]?.idempotencyKey).toBe('stable-key-1');
  });

  it('replays in creation order and preserves the same idempotency key', async () => {
    const storage = memoryStorage();
    const outbox = new OutboxStore(storage);
    outbox.enqueue({ id: 'b', kind: 'TEST', organizationId: 'org', idempotencyKey: 'key-b', payload: {}, createdAt: '2026-08-23T18:02:00.000Z' });
    outbox.enqueue({ id: 'a', kind: 'TEST', organizationId: 'org', idempotencyKey: 'key-a', payload: {}, createdAt: '2026-08-23T18:01:00.000Z' });

    const seen: string[] = [];
    const coordinator = new SyncCoordinator(outbox, {
      TEST: async (operation) => {
        seen.push(operation.idempotencyKey);
        return { status: 'SYNCED', serverId: `server-${operation.id}` };
      },
    });

    await coordinator.replayPending();
    expect(seen).toEqual(['key-a', 'key-b']);
    expect(outbox.list().every((item) => item.status === 'SYNCED')).toBe(true);
  });

  it('keeps deterministic server rejection as a conflict instead of retrying it as success', async () => {
    const outbox = new OutboxStore(memoryStorage());
    outbox.enqueue({ id: 'sale-1', kind: 'SALE', organizationId: 'org', branchId: 'branch', idempotencyKey: 'sale-key-1', payload: {}, createdAt: '2026-08-23T18:01:00.000Z' });

    const coordinator = new SyncCoordinator(outbox, {
      SALE: async () => ({ status: 'CONFLICT', errorCode: 'INSUFFICIENT_STOCK' }),
    });

    const result = await coordinator.replayPending();
    expect(result.conflicts).toBe(1);
    expect(outbox.conflicts()[0]?.lastErrorCode).toBe('INSUFFICIENT_STOCK');
  });

  it('turns a missing replay handler into a terminal conflict', async () => {
    const outbox = new OutboxStore(memoryStorage());
    outbox.enqueue({ id: 'unknown-1', kind: 'UNKNOWN', organizationId: 'org', idempotencyKey: 'unknown-key', payload: {}, createdAt: '2026-08-23T18:01:00.000Z' });

    const coordinator = new SyncCoordinator(outbox, {});
    const result = await coordinator.replayPending();

    expect(result.conflicts).toBe(1);
    expect(outbox.pending()).toHaveLength(0);
    expect(outbox.conflicts()[0]?.lastErrorCode).toBe('OUTBOX_HANDLER_MISSING');
  });

  it('backs off retryable failures instead of retrying on every replay loop', async () => {
    const outbox = new OutboxStore(memoryStorage());
    outbox.enqueue({ id: 'retry-1', kind: 'TEST', organizationId: 'org', idempotencyKey: 'retry-key', payload: {}, createdAt: '2026-08-23T18:01:00.000Z' });
    let now = new Date('2026-08-23T18:10:00.000Z');
    let attempts = 0;
    const coordinator = new SyncCoordinator(outbox, {
      TEST: async () => {
        attempts += 1;
        return { status: 'FAILED', errorCode: 'NETWORK', retryable: true };
      },
    }, { now: () => now, retryBaseMs: 2_000, retryMaxMs: 10_000 });

    await coordinator.replayPending();
    expect(attempts).toBe(1);
    expect(outbox.list()[0]?.nextAttemptAt).toBe('2026-08-23T18:10:02.000Z');

    await coordinator.replayPending();
    expect(attempts).toBe(1);

    now = new Date('2026-08-23T18:10:02.000Z');
    await coordinator.replayPending();
    expect(attempts).toBe(2);
    expect(outbox.list()[0]?.nextAttemptAt).toBe('2026-08-23T18:10:06.000Z');
  });

  it('recovers a stale syncing operation after an interrupted app session', () => {
    const outbox = new OutboxStore(memoryStorage());
    outbox.enqueue({ id: 'stale-1', kind: 'TEST', organizationId: 'org', idempotencyKey: 'stale-key', payload: {}, createdAt: '2026-08-23T18:01:00.000Z' });
    outbox.update('stale-1', { status: 'SYNCING', lastAttemptAt: '2026-08-23T18:05:00.000Z', attemptCount: 1 });

    expect(outbox.pending(new Date('2026-08-23T18:06:00.000Z'))).toHaveLength(0);
    expect(outbox.pending(new Date('2026-08-23T18:08:00.000Z'))).toHaveLength(1);
  });
});
