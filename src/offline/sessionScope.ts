import { LocalStore } from './localStore';
import {
  OutboxOwnerMismatchError,
  OutboxStore,
  type OutboxOperation,
  type OutboxStoreOptions,
} from './outbox';
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
  private activeUserId: string | null = null;
  private requestedUserId: string | null = null;
  private hasBindingRequest = false;
  private binding = Promise.resolve();

  constructor(storage?: KeyValueStorage, outboxOptions: OutboxStoreOptions = {}) {
    this.scopeStorage = createNamespacedStorage('pharmacystock:offline-scope:v1', storage);
    this.localStore = new LocalStore(storage);
    this.outbox = new OutboxStore(storage, outboxOptions);
  }

  bindUser(userId: string | null): Promise<void> {
    if (this.hasBindingRequest
      && this.requestedUserId === userId
      && !this.outbox.supportsAtomicOwnerTransition()) return this.binding;
    this.hasBindingRequest = true;
    this.requestedUserId = userId;
    // Invalidate any in-flight replay immediately, before the durable account
    // boundary work completes.
    this.generation += 1;
    this.binding = this.binding.catch(() => undefined).then(() => this.performBind(userId)).catch((error) => {
      if (this.requestedUserId === userId) this.hasBindingRequest = false;
      throw error;
    });
    return this.binding;
  }

  private async performBind(userId: string | null): Promise<void> {
    if (this.outbox.supportsAtomicOwnerTransition()) {
      await this.performAtomicBind(userId);
      return;
    }

    const previousUserId = this.scopeStorage.get(OWNER_KEY);

    if (previousUserId === userId) {
      this.activeUserId = userId;
      return;
    }

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
    this.activeUserId = userId;
  }

  private async performAtomicBind(userId: string | null): Promise<void> {
    let previousUserId = await this.outbox.owner();
    if (previousUserId) await this.migrateLegacyVault(previousUserId);
    if (userId && userId !== previousUserId) await this.migrateLegacyVault(userId);
    previousUserId = await this.outbox.owner();
    let attempts = 0;
    while (previousUserId !== userId) {
      attempts += 1;
      if (attempts > 8) throw new Error('OUTBOX_OWNER_TRANSITION_RETRY_LIMIT');
      try {
        await this.outbox.transitionOwner(previousUserId, userId);
        break;
      } catch (error) {
        if (!(error instanceof OutboxOwnerMismatchError)) throw error;
        previousUserId = error.actualOwnerId;
      }
    }

    if (previousUserId !== userId) this.localStore.clear();
    this.activeUserId = userId;
  }

  private async migrateLegacyVault(userId: string): Promise<void> {
    const vaultKey = `vault:${userId}`;
    const legacyVault = this.scopeStorage.get(vaultKey);
    if (!legacyVault) return;
    const imported = await this.outbox.importLegacyVault(userId, legacyVault);
    if (imported && this.scopeStorage.get(vaultKey) === legacyVault) this.scopeStorage.remove(vaultKey);
  }

  replayScope(): OfflineReplayScope {
    return { userId: this.activeUserId, generation: this.generation };
  }

  async verifiedReplayScope(): Promise<OfflineReplayScope> {
    const scope = this.replayScope();
    if (!scope.userId || !this.outbox.supportsAtomicOwnerTransition()) return scope;
    const owner = await this.outbox.owner();
    return owner === scope.userId ? scope : { ...scope, userId: null };
  }

  isReplayScopeCurrent(scope: OfflineReplayScope): boolean {
    return Boolean(scope.userId)
      && scope.userId === this.activeUserId
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
