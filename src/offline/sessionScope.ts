import { LocalStore } from './localStore';
import {
  OutboxOwnerMismatchError,
  OutboxStore,
  type OutboxStoreOptions,
} from './outbox';
import { createNamespacedStorage, type KeyValueStorage } from './storage';

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
  private binding = Promise.resolve();

  constructor(storage?: KeyValueStorage, outboxOptions: OutboxStoreOptions = {}) {
    this.scopeStorage = createNamespacedStorage('pharmacystock:offline-scope:v1', storage);
    this.localStore = new LocalStore(storage);
    this.outbox = new OutboxStore(storage, outboxOptions);
  }

  bindUser(userId: string | null): Promise<void> {
    this.requestedUserId = userId;
    // Invalidate any in-flight replay immediately, before the durable account
    // boundary work completes.
    this.generation += 1;
    this.binding = this.binding.catch(() => undefined).then(() => this.performBind(userId));
    return this.binding;
  }

  private async performBind(userId: string | null): Promise<void> {
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
    if (!scope.userId) return scope;
    const owner = await this.outbox.owner();
    return owner === scope.userId ? scope : { ...scope, userId: null };
  }

  isReplayScopeCurrent(scope: OfflineReplayScope): boolean {
    return Boolean(scope.userId)
      && scope.userId === this.activeUserId
      && scope.userId === this.requestedUserId
      && scope.generation === this.generation;
  }

}

export const offlineSessionScope = new OfflineSessionScope();
