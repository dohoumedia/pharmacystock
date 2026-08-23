import { createNamespacedStorage, type KeyValueStorage } from './storage';

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'FAILED';

export type OutboxOperation<TPayload = unknown> = {
  id: string;
  kind: string;
  organizationId: string;
  branchId?: string;
  idempotencyKey: string;
  payload: TPayload;
  createdAt: string;
  status: OutboxStatus;
  attemptCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  serverId?: string;
};

type PersistedOutbox = {
  version: 1;
  operations: OutboxOperation[];
};

const KEY = 'operations';

function sortOperations(operations: OutboxOperation[]) {
  return [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export class OutboxStore {
  private readonly storage;

  constructor(storage?: KeyValueStorage) {
    this.storage = createNamespacedStorage('pharmacystock:outbox:v1', storage);
  }

  list(): OutboxOperation[] {
    const raw = this.storage.get(KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as PersistedOutbox;
      if (parsed.version !== 1 || !Array.isArray(parsed.operations)) return [];
      return sortOperations(parsed.operations);
    } catch {
      return [];
    }
  }

  enqueue<TPayload>(operation: Omit<OutboxOperation<TPayload>, 'status' | 'attemptCount'>): OutboxOperation<TPayload> {
    const current = this.list();
    const duplicate = current.find((item) => item.idempotencyKey === operation.idempotencyKey);
    if (duplicate) return duplicate as OutboxOperation<TPayload>;

    const next: OutboxOperation<TPayload> = {
      ...operation,
      status: 'PENDING',
      attemptCount: 0,
    };
    this.write([...current, next]);
    return next;
  }

  update(id: string, patch: Partial<Omit<OutboxOperation, 'id' | 'idempotencyKey' | 'createdAt'>>): OutboxOperation | null {
    const current = this.list();
    let updated: OutboxOperation | null = null;
    const next = current.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...patch };
      return updated;
    });
    if (updated) this.write(next);
    return updated;
  }

  pending(now = new Date(), staleSyncingAfterMs = 2 * 60 * 1000): OutboxOperation[] {
    const nowMs = now.getTime();
    return this.list().filter((item) => {
      if (item.status === 'PENDING') return true;
      if (item.status === 'FAILED') {
        return !item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= nowMs;
      }
      if (item.status === 'SYNCING' && item.lastAttemptAt) {
        return nowMs - new Date(item.lastAttemptAt).getTime() >= staleSyncingAfterMs;
      }
      return false;
    });
  }

  conflicts(): OutboxOperation[] {
    return this.list().filter((item) => item.status === 'CONFLICT');
  }

  removeSynced(): void {
    this.write(this.list().filter((item) => item.status !== 'SYNCED'));
  }

  clear(): void {
    this.storage.remove(KEY);
  }

  private write(operations: OutboxOperation[]): void {
    const value: PersistedOutbox = { version: 1, operations: sortOperations(operations) };
    this.storage.set(KEY, JSON.stringify(value));
  }
}

export function createOutboxId(prefix: string, now = Date.now(), random = Math.random()) {
  return `${prefix}:${now.toString(36)}:${Math.floor(random * 1_000_000_000).toString(36)}`;
}
