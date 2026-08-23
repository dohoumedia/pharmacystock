import { LocalStore } from './localStore';
import { OutboxStore } from './outbox';
import { createNamespacedStorage, type KeyValueStorage } from './storage';

const OWNER_KEY = 'user-id';

export class OfflineSessionScope {
  private readonly scopeStorage;
  private readonly localStore: LocalStore;
  private readonly outbox: OutboxStore;

  constructor(storage?: KeyValueStorage) {
    this.scopeStorage = createNamespacedStorage('pharmacystock:offline-scope:v1', storage);
    this.localStore = new LocalStore(storage);
    this.outbox = new OutboxStore(storage);
  }

  bindUser(userId: string | null): void {
    const previousUserId = this.scopeStorage.get(OWNER_KEY);

    if (!userId || previousUserId !== userId) {
      this.localStore.clear();
      this.outbox.clear();
    }

    if (userId) this.scopeStorage.set(OWNER_KEY, userId);
    else this.scopeStorage.remove(OWNER_KEY);
  }
}

export const offlineSessionScope = new OfflineSessionScope();
