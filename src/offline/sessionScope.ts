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

type BindingState = 'idle' | 'pending' | 'failed';

export class OfflineSessionScope {
  private readonly scopeStorage;
  private readonly localStore: LocalStore;
  private readonly outbox: OutboxStore;
  private generation = 0;
  private activeUserId: string | null = null;
  private requestedUserId: string | null = null;
  private binding = Promise.resolve();
  private bindingState: BindingState = 'idle';
  private hasBound = false;

  constructor(storage?: KeyValueStorage, outboxOptions: OutboxStoreOptions = {}) {
    this.scopeStorage = createNamespacedStorage('pharmacystock:offline-scope:v1', storage);
    this.localStore = new LocalStore(storage);
    this.outbox = new OutboxStore(storage, outboxOptions);
  }

  bindUser(userId: string | null): Promise<void> {
    const identityChanged = userId !== this.requestedUserId;
    if (!identityChanged && this.bindingState === 'pending') return this.binding;

    if (identityChanged || !this.hasBound) {
      // Invalidate any in-flight replay immediately when establishing the
      // initial scope or crossing a real account boundary. Same-user session
      // replacement keeps the generation but still revalidates durable owner
      // state in case another tab changed it.
      this.generation += 1;
    }
    this.requestedUserId = userId;
    this.bindingState = 'pending';
    const pending = this.binding.catch(() => undefined).then(() => this.performBind(userId));
    let tracked: Promise<void>;
    tracked = pending.then(
      () => {
        if (this.binding !== tracked) return;
        this.bindingState = 'idle';
        this.hasBound = true;
      },
      (error) => {
        if (this.binding === tracked) this.bindingState = 'failed';
        throw error;
      },
    );
    this.binding = tracked;
    return tracked;
  }

  private async performBind(userId: string | null): Promise<void> {
    let previousUserId = await this.outbox.owner();
    // Only the authenticated target user proves ownership of a legacy per-user
    // vault. Never inspect or recover the previous local owner while another
    // account is binding.
    if (userId) await this.migrateLegacyVault(userId);
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
    const imported = await this.outbox.importLegacyVault(userId, legacyVault, { ownershipProven: true });
    if (imported && this.scopeStorage.get(vaultKey) === legacyVault) {
      try {
        this.scopeStorage.remove(vaultKey);
      } catch {
        // Recovery is already durable. Retaining the legacy source makes the
        // cleanup retryable without turning a committed recovery into failure.
      }
    }
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
