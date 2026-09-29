import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';

const LEGACY_OUTBOX_KEY = 'pharmacystock:outbox:v1:operations';
const LEGACY_OWNER_KEY = 'pharmacystock:offline-scope:v1:user-id';
const legacyVaultKey = (userId: string) => `pharmacystock:offline-scope:v1:vault:${userId}`;

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function operation(
  id: string,
  idempotencyKey: string,
  payload: unknown = { saleNumber: id },
  status: OutboxOperation['status'] = 'PENDING',
): OutboxOperation {
  return {
    id,
    kind: 'SALE',
    organizationId: 'org-a',
    branchId: 'branch-a',
    idempotencyKey,
    payload,
    createdAt: '2026-09-28T12:00:00.000Z',
    status,
    attemptCount: status === 'SYNCING' ? 1 : 0,
    ...(status === 'SYNCING' ? {
      lastAttemptAt: '2026-09-28T12:01:00.000Z',
      lastErrorCode: 'NETWORK_OR_UNKNOWN_ERROR',
      nextAttemptAt: '2026-09-28T12:02:00.000Z',
    } : {}),
  };
}

function seedLegacyOwner(storage: KeyValueStorage, userId: string): void {
  storage.setItem(LEGACY_OWNER_KEY, userId);
}

function seedLegacyVault(storage: KeyValueStorage, userId: string, operations: unknown[]): void {
  storage.setItem(legacyVaultKey(userId), JSON.stringify({ operations }));
}

function seedLegacyOutbox(storage: KeyValueStorage, operations: unknown[]): void {
  storage.setItem(LEGACY_OUTBOX_KEY, JSON.stringify({ version: 1, operations }));
}

function scope(factory: IDBFactory, storage: KeyValueStorage, databaseName: string): OfflineSessionScope {
  return new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
}

function outbox(factory: IDBFactory, storage: KeyValueStorage, databaseName: string): OutboxStore {
  return new OutboxStore(storage, { indexedDB: factory, databaseName });
}

describe('legacy outbox quarantine recovery', () => {
  it('recovers a legitimate quarantined operation once its authenticated owner is established', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'legacy-recovery-proven-owner';
    const recovered = operation('sale-a', 'stable-sale-a');
    seedLegacyOwner(storage, 'user-a');
    seedLegacyVault(storage, 'user-a', [recovered]);

    await scope(factory, storage, databaseName).bindUser('user-a');
    const restored = outbox(factory, storage, databaseName);
    await restored.refresh('user-a');

    expect(restored.list()).toEqual([recovered]);
    expect(storage.getItem(legacyVaultKey('user-a'))).toBeNull();
  });

  it('does not expose or recover another user\'s quarantined operation', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'legacy-recovery-wrong-owner';
    const userAOperation = operation('sale-a', 'stable-sale-a');
    seedLegacyOwner(storage, 'user-a');
    seedLegacyVault(storage, 'user-a', [userAOperation]);

    const session = scope(factory, storage, databaseName);
    await session.bindUser('user-b');
    const userBOutbox = outbox(factory, storage, databaseName);
    await userBOutbox.refresh('user-b');

    expect(userBOutbox.list()).toEqual([]);
    expect(storage.getItem(legacyVaultKey('user-a'))).not.toBeNull();

    await session.bindUser('user-a');
    await userBOutbox.refresh('user-a');
    expect(userBOutbox.list()).toEqual([userAOperation]);
  });

  it('keeps ownerless legacy operations quarantined across authenticated users', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'legacy-recovery-ownerless';
    seedLegacyOutbox(storage, [operation('ownerless-sale', 'ownerless-key')]);

    const session = scope(factory, storage, databaseName);
    await session.bindUser('user-a');
    const active = outbox(factory, storage, databaseName);
    await active.refresh('user-a');
    expect(active.list()).toEqual([]);

    await session.bindUser('user-b');
    await active.refresh('user-b');
    expect(active.list()).toEqual([]);
  });

  it('collapses an immutable retry without overwriting the active operation state', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'legacy-recovery-identical-duplicate';
    const active = {
      ...operation('sale-a', 'stable-sale-a', { saleNumber: 'same-sale' }, 'CONFLICT'),
      attemptCount: 2,
      lastErrorCode: 'INSUFFICIENT_STOCK',
    };
    const duplicate = operation('legacy-copy', 'stable-sale-a', { saleNumber: 'same-sale' });
    seedLegacyOwner(storage, 'user-a');
    seedLegacyOutbox(storage, [active]);
    seedLegacyVault(storage, 'user-a', [duplicate]);

    await scope(factory, storage, databaseName).bindUser('user-a');
    const restored = outbox(factory, storage, databaseName);
    await restored.refresh('user-a');

    expect(restored.list()).toEqual([active]);
    expect(storage.getItem(legacyVaultKey('user-a'))).toBeNull();
  });

  it('does not merge conflicting immutable content that reuses an idempotency key', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'legacy-recovery-immutable-conflict';
    const active = operation('sale-a', 'shared-key', { total: 10 });
    const conflicting = operation('sale-b', 'shared-key', { total: 20 });
    seedLegacyOwner(storage, 'user-a');
    seedLegacyOutbox(storage, [active]);
    seedLegacyVault(storage, 'user-a', [conflicting]);

    await scope(factory, storage, databaseName).bindUser('user-a');
    const restored = outbox(factory, storage, databaseName);
    await restored.refresh('user-a');

    expect(restored.list()).toEqual([active]);
    expect(JSON.parse(storage.getItem(legacyVaultKey('user-a')) ?? '{}').operations).toEqual([conflicting]);
  });

  it('makes repeated recovery attempts idempotent when legacy cleanup is interrupted', async () => {
    const factory = new IDBFactory();
    const baseStorage = memoryStorage();
    const databaseName = 'legacy-recovery-repeat';
    const recovered = operation('sale-a', 'stable-sale-a');
    const vaultKey = legacyVaultKey('user-a');
    let failCleanup = true;
    const storage: KeyValueStorage = {
      getItem: (key) => baseStorage.getItem(key),
      setItem: (key, value) => baseStorage.setItem(key, value),
      removeItem: (key) => {
        if (key === vaultKey && failCleanup) throw new Error('simulated legacy cleanup interruption');
        baseStorage.removeItem(key);
      },
    };
    seedLegacyOwner(storage, 'user-a');
    seedLegacyVault(storage, 'user-a', [recovered]);

    const session = scope(factory, storage, databaseName);
    await session.bindUser('user-a');
    expect(storage.getItem(vaultKey)).not.toBeNull();

    failCleanup = false;
    await session.bindUser('user-a');
    const restored = outbox(factory, storage, databaseName);
    await restored.refresh('user-a');

    expect(restored.list()).toEqual([recovered]);
    expect(storage.getItem(vaultKey)).toBeNull();
  });

  it('does not leak a recovered operation during account switching', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'legacy-recovery-account-switch';
    const recovered = operation('sale-a', 'stable-sale-a');
    seedLegacyOwner(storage, 'user-a');
    seedLegacyVault(storage, 'user-a', [recovered]);

    const session = scope(factory, storage, databaseName);
    const active = outbox(factory, storage, databaseName);
    await session.bindUser('user-a');
    await active.refresh('user-a');
    expect(active.list()).toEqual([recovered]);

    await session.bindUser('user-b');
    await active.refresh('user-b');
    expect(active.list()).toEqual([]);

    await session.bindUser('user-a');
    await active.refresh('user-a');
    expect(active.list()).toEqual([recovered]);
  });

  it('recovers an interrupted syncing operation as pending with its stable idempotency key', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'legacy-recovery-interrupted-sync';
    const interrupted = operation('sale-a', 'stable-sale-a', { saleNumber: 'sale-a' }, 'SYNCING');
    seedLegacyOwner(storage, 'user-a');
    seedLegacyVault(storage, 'user-a', [interrupted]);

    await scope(factory, storage, databaseName).bindUser('user-a');
    const restored = outbox(factory, storage, databaseName);
    await restored.refresh('user-a');

    expect(restored.list()).toEqual([expect.objectContaining({
      id: 'sale-a',
      idempotencyKey: 'stable-sale-a',
      status: 'PENDING',
      attemptCount: 1,
    })]);
    expect(restored.list()[0]?.nextAttemptAt).toBeUndefined();
    expect(restored.list()[0]?.lastErrorCode).toBeUndefined();
  });
});
