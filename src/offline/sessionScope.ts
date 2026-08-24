import { LocalStore } from './localStore';
import { OutboxStore, type OutboxOperation } from './outbox';
import { createNamespacedStorage, type KeyValueStorage } from './storage';

const OWNER_KEY = 'user-id';
const UNOWNED_VAULT = '__unowned__';

type OfflineVault = {
  operations: OutboxOperation[];
};

export type OfflineReplayScope = {
  userId: string | null;
  generation: number;
};

export class OfflineSessionScope {
  private readonly scopeStorage;
  private readonly localStore: LocalStore;
  private readonly outbox: OutboxStore;
  private generation = 0;

  constructor(storage?: KeyValueStorage) {
    this.scopeStorage = createNamespacedStorage('pharmacystock:offline-scope:v1', storage);
    this.localStore = new LocalStore(storage);
    this.outbox = new OutboxStore(storage);
  }

  bindUser(userId: string | null): void {
    const previousUserId = this.scopeStorage.get(OWNER_KEY);

    if (previousUserId === userId) return;

    if (previousUserId) this.stash(previousUserId);
    else if (this.outbox.list().length > 0) this.stash(UNOWNED_VAULT);

    this.localStore.clear();
    this.outbox.clear();
    this.generation += 1;

    if (userId) {
      this.scopeStorage.set(OWNER_KEY, userId);
      this.restore(userId);
    } else {
      this.scopeStorage.remove(OWNER_KEY);
    }
  }

  replayScope(): OfflineReplayScope {
    return { userId: this.scopeStorage.get(OWNER_KEY), generation: this.generation };
  }

  isReplayScopeCurrent(scope: OfflineReplayScope): boolean {
    return Boolean(scope.userId)
      && scope.userId === this.scopeStorage.get(OWNER_KEY)
      && scope.generation === this.generation;
  }

  private stash(owner: string): void {
    const vault: OfflineVault = {
      operations: this.outbox.list().filter((operation) => operation.status !== 'SYNCED'),
    };
    this.scopeStorage.set(`vault:${owner}`, JSON.stringify(vault));
  }

  private restore(owner: string): void {
    const raw = this.scopeStorage.get(`vault:${owner}`);
    if (!raw) return;
    try {
      const vault = JSON.parse(raw) as OfflineVault;
      this.outbox.replaceAll(Array.isArray(vault.operations) ? vault.operations : []);
    } catch {
      // Keep malformed vault data quarantined rather than exposing it to a session.
    }
  }
}

export const offlineSessionScope = new OfflineSessionScope();
