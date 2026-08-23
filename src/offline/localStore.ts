import { createNamespacedStorage, type KeyValueStorage } from './storage';

export type LocalSnapshot<T> = {
  data: T;
  syncedAt: string;
  serverRevision?: string;
};

type PersistedReplica = {
  version: 1;
  records: Record<string, LocalSnapshot<unknown>>;
};

const KEY = 'replica';

export class LocalStore {
  private readonly storage;

  constructor(storage?: KeyValueStorage) {
    this.storage = createNamespacedStorage('pharmacystock:replica:v1', storage);
  }

  get<T>(key: string): LocalSnapshot<T> | null {
    return (this.read().records[key] as LocalSnapshot<T> | undefined) ?? null;
  }

  set<T>(key: string, snapshot: LocalSnapshot<T>): void {
    const current = this.read();
    current.records[key] = snapshot as LocalSnapshot<unknown>;
    this.write(current);
  }

  remove(key: string): void {
    const current = this.read();
    delete current.records[key];
    this.write(current);
  }

  clear(): void {
    this.storage.remove(KEY);
  }

  private read(): PersistedReplica {
    const raw = this.storage.get(KEY);
    if (!raw) return { version: 1, records: {} };
    try {
      const parsed = JSON.parse(raw) as PersistedReplica;
      if (parsed.version !== 1 || typeof parsed.records !== 'object' || parsed.records === null) {
        return { version: 1, records: {} };
      }
      return parsed;
    } catch {
      return { version: 1, records: {} };
    }
  }

  private write(value: PersistedReplica): void {
    this.storage.set(KEY, JSON.stringify(value));
  }
}
