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
  private requestedUserId: string | null;
  private binding = Promise.resolve();

  constructor(storage?: KeyValueStorage) {
    this.scopeStorage = createNamespacedStorage('pharmacystock:offline-scope:v1', storage);
    this.localStore = new LocalStore(storage);
    this.outbox = new OutboxStore(storage);
    this.requestedUserId = this.scopeStorage.get(OWNER_KEY);
  }

  bindUser(userId: string | null): Promise<void> {
    if (this.requestedUserId === userId) return this.binding;
    this.requestedUserId = userId;
    // Invalidate any in-flight replay immediately, before the durable account
    // boundary work completes.
    this.generation += 1;
    this.binding = this.binding.then(() => this.performBind(userId));
    return this.binding;
  }

  private async performBind(userId: string | null): Promise<void> {
    const previousUserId = this.scopeStorage.get(OWNER_KEY);

    if (previousUserId === userId) return;

    await this.outbox.refresh();
    if (previousUserId) await this.stash(previousUserId);
    else if (this.outbox.list().length > 0) await this.stash(UNOWNED_VAULT);

    this.localStore.clear();
    await this.outbox.clear();

    if (userId) {
      this.scopeStorage.set(OWNER_KEY, userId);
      await this.restore(userId);
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
      && scope.userId === this.requestedUserId
      && scope.generation === this.generation;
  }

  private async stash(owner: string): Promise<void> {
    await this.outbox.refresh();
    const vault: OfflineVault = {
      operations: this.outbox.list().filter((operation) => operation.status !== 'SYNCED'),
    };
    this.scopeStorage.set(`vault:${owner}`, JSON.stringify(vault));
  }

  private async restore(owner: string): Promise<void> {
    const raw = this.scopeStorage.get(`vault:${owner}`);
    if (!raw) return;
    try {
      const vault = JSON.parse(raw) as OfflineVault;
      const operations = Array.isArray(vault.operations) ? vault.operations : [];
      await this.outbox.replaceAll(operations.map((operation) => {
        if (operation.status !== 'SYNCING') return operation;
        // A session switch can interrupt replay after the server has already
        // accepted the request but before local state is updated. Replaying the
        // same intent immediately is safe because the original idempotency key
        // is preserved, and avoids waiting for the stale-SYNCING timeout.
        return {
          ...operation,
          status: 'PENDING',
          nextAttemptAt: undefined,
          lastErrorCode: undefined,
        };
      }));
    } catch {
      // Keep malformed vault data quarantined rather than exposing it to a session.
    }
  }
}

export const offlineSessionScope = new OfflineSessionScope();
