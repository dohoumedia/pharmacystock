import { IndexedDbOutboxPersistence } from './outboxIndexedDb';
import { createNamespacedStorage, getLocalStorage, type KeyValueStorage } from './storage';

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

export type OutboxUpdate = Partial<Omit<OutboxOperation, 'id' | 'idempotencyKey' | 'createdAt'>>;

export interface OutboxPersistence {
  list(): Promise<OutboxOperation[]>;
  listSync?(): OutboxOperation[];
  enqueue(operation: OutboxOperation): Promise<OutboxOperation>;
  update(id: string, patch: OutboxUpdate): Promise<OutboxOperation | null>;
  removeSynced(): Promise<void>;
  clear(): Promise<void>;
  replaceAll(operations: OutboxOperation[]): Promise<void>;
}

type PersistedOutbox = {
  version: 1;
  operations: OutboxOperation[];
};

type OutboxStoreOptions = {
  indexedDB?: IDBFactory;
  databaseName?: string;
};

const KEY = 'operations';
const NAMESPACE = 'pharmacystock:outbox:v1';
const CHANGE_CHANNEL = 'pharmacystock:outbox:v2:changes';
const fallbackListeners = new Set<() => void>();
const storageQueues = new WeakMap<KeyValueStorage, Promise<void>>();

function sortOperations(operations: OutboxOperation[]) {
  return [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function parsePersisted(raw: string | null): OutboxOperation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PersistedOutbox;
    if (parsed.version !== 1 || !Array.isArray(parsed.operations)) return [];
    return sortOperations(parsed.operations);
  } catch {
    return [];
  }
}

class KeyValueOutboxPersistence implements OutboxPersistence {
  private readonly namespaced;

  constructor(private readonly storage: KeyValueStorage) {
    this.namespaced = createNamespacedStorage(NAMESPACE, storage);
  }

  async list(): Promise<OutboxOperation[]> {
    await (storageQueues.get(this.storage) ?? Promise.resolve());
    return this.listSync();
  }

  listSync(): OutboxOperation[] {
    return parsePersisted(this.namespaced.get(KEY));
  }

  enqueue(operation: OutboxOperation): Promise<OutboxOperation> {
    return this.mutate((current) => {
      const duplicate = current.find((item) => item.idempotencyKey === operation.idempotencyKey);
      return { operations: duplicate ? current : [...current, operation], result: duplicate ?? operation };
    });
  }

  update(id: string, patch: OutboxUpdate): Promise<OutboxOperation | null> {
    return this.mutate((current) => {
      let updated: OutboxOperation | null = null;
      const operations = current.map((item) => {
        if (item.id !== id) return item;
        updated = { ...item, ...patch };
        return updated;
      });
      return { operations, result: updated };
    });
  }

  removeSynced(): Promise<void> {
    return this.mutate((current) => ({
      operations: current.filter((item) => item.status !== 'SYNCED'),
      result: undefined,
    }));
  }

  clear(): Promise<void> {
    return this.runExclusive(() => {
      this.namespaced.remove(KEY);
    });
  }

  replaceAll(operations: OutboxOperation[]): Promise<void> {
    return this.runExclusive(() => this.write(operations));
  }

  private async mutate<TResult>(
    mutation: (operations: OutboxOperation[]) => { operations: OutboxOperation[]; result: TResult },
  ): Promise<TResult> {
    let result!: TResult;
    await this.runExclusive(() => {
      const next = mutation(parsePersisted(this.namespaced.get(KEY)));
      this.write(next.operations);
      result = next.result;
    });
    return result;
  }

  private runExclusive(action: () => void): Promise<void> {
    const previous = storageQueues.get(this.storage) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    storageQueues.set(this.storage, next);
    return next;
  }

  private write(operations: OutboxOperation[]): void {
    if (operations.length === 0) {
      this.namespaced.remove(KEY);
      return;
    }
    const value: PersistedOutbox = { version: 1, operations: sortOperations(operations) };
    this.namespaced.set(KEY, JSON.stringify(value));
  }
}

export class OutboxStore {
  private readonly persistence: OutboxPersistence;
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;
  private operations: OutboxOperation[] = [];
  private readonly initialization: Promise<void>;

  constructor(storage?: KeyValueStorage, options: OutboxStoreOptions = {}) {
    const legacyStorage = storage ?? getLocalStorage();
    const indexedDB = options.indexedDB
      ?? (storage === undefined && typeof globalThis.indexedDB !== 'undefined' ? globalThis.indexedDB : undefined);
    this.persistence = indexedDB
      ? new IndexedDbOutboxPersistence(indexedDB, legacyStorage, options.databaseName)
      : new KeyValueOutboxPersistence(legacyStorage);
    this.channel = indexedDB && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(CHANGE_CHANNEL)
      : null;
    if (this.channel) {
      this.channel.onmessage = () => {
        void this.refresh().then(() => this.notify()).catch(() => undefined);
      };
    }
    this.initialization = this.load();
    void this.initialization.catch(() => undefined);
  }

  async ready(): Promise<void> {
    await this.initialization;
  }

  list(): OutboxOperation[] {
    if (this.persistence.listSync) this.operations = this.persistence.listSync();
    return sortOperations(this.operations);
  }

  async refresh(): Promise<OutboxOperation[]> {
    await this.initialization;
    await this.load();
    return this.list();
  }

  async enqueue<TPayload>(
    operation: Omit<OutboxOperation<TPayload>, 'status' | 'attemptCount'>,
  ): Promise<OutboxOperation<TPayload>> {
    await this.initialization;
    const next: OutboxOperation<TPayload> = { ...operation, status: 'PENDING', attemptCount: 0 };
    const persisted = await this.persistence.enqueue(next);
    await this.changed();
    return persisted as OutboxOperation<TPayload>;
  }

  async update(id: string, patch: OutboxUpdate): Promise<OutboxOperation | null> {
    await this.initialization;
    const updated = await this.persistence.update(id, patch);
    if (updated) await this.changed();
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

  async removeSynced(): Promise<void> {
    await this.initialization;
    await this.persistence.removeSynced();
    await this.changed();
  }

  async clear(): Promise<void> {
    await this.initialization;
    await this.persistence.clear();
    await this.changed();
  }

  async replaceAll(operations: OutboxOperation[]): Promise<void> {
    await this.initialization;
    await this.persistence.replaceAll(operations);
    await this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.channel) fallbackListeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      fallbackListeners.delete(listener);
    };
  }

  private async load(): Promise<void> {
    this.operations = await this.persistence.list();
  }

  private async changed(): Promise<void> {
    await this.load();
    if (this.channel) {
      this.notify();
      this.channel.postMessage({ changed: true });
    } else {
      for (const listener of fallbackListeners) listener();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createOutboxId(prefix: string, now = Date.now(), random = Math.random()) {
  return `${prefix}:${now.toString(36)}:${Math.floor(random * 1_000_000_000).toString(36)}`;
}
