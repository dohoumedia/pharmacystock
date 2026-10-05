import { IndexedDbOutboxPersistence } from './outboxIndexedDb';
import { isRecoverableLegacyOperation, parseOutboxTimestamp, resetInterruptedReplay } from './outboxRecovery';
import { createNamespacedStorage, getLocalStorage, type KeyValueStorage } from './storage';

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'FAILED';

export const OUTBOX_STALE_SYNCING_AFTER_MS = 2 * 60 * 1000;

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

export function outboxReplayEligibleAt(
  operation: OutboxOperation,
  staleSyncingAfterMs = OUTBOX_STALE_SYNCING_AFTER_MS,
): number | null {
  if (operation.status === 'PENDING') return 0;
  if (operation.status === 'FAILED') {
    if (operation.nextAttemptAt === undefined) return 0;
    return parseOutboxTimestamp(operation.nextAttemptAt);
  }
  if (operation.status === 'SYNCING') {
    const lastAttemptAt = parseOutboxTimestamp(operation.lastAttemptAt);
    return lastAttemptAt === null ? null : lastAttemptAt + staleSyncingAfterMs;
  }
  return null;
}

export type OutboxEnqueueValidator = (operations: readonly OutboxOperation[]) => void;

export type OutboxEnqueueOptions = {
  validate?: OutboxEnqueueValidator;
  requireCrossContextAtomicity?: boolean;
};

export type LegacyVaultImportOptions = {
  ownershipProven: boolean;
};

export type ScopeTransitionPoint =
  | 'after-owner-check'
  | 'after-vault'
  | 'after-clear'
  | 'after-restore'
  | 'after-owner-write';

export class OutboxOwnerMismatchError extends Error {
  constructor(
    readonly expectedOwnerId: string | null,
    readonly actualOwnerId: string | null,
  ) {
    super('OUTBOX_OWNER_CHANGED');
    this.name = 'OutboxOwnerMismatchError';
  }
}

export class OutboxIdempotencyConflictError extends Error {
  readonly code = 'OUTBOX_IDEMPOTENCY_CONFLICT';

  constructor(readonly idempotencyKey: string) {
    super('OUTBOX_IDEMPOTENCY_CONFLICT');
    this.name = 'OutboxIdempotencyConflictError';
  }
}

export class OutboxAtomicCoordinationUnavailableError extends Error {
  readonly code = 'OUTBOX_ATOMIC_COORDINATION_UNAVAILABLE';

  constructor() {
    super('OUTBOX_ATOMIC_COORDINATION_UNAVAILABLE');
    this.name = 'OutboxAtomicCoordinationUnavailableError';
  }
}

export interface OutboxPersistence {
  readonly supportsCrossContextAtomicity: boolean;
  list(expectedOwnerId?: string): Promise<OutboxOperation[]>;
  listSync?(): OutboxOperation[];
  enqueue(
    operation: OutboxOperation,
    expectedOwnerId?: string,
    validate?: OutboxEnqueueValidator,
  ): Promise<OutboxOperation>;
  update(id: string, patch: OutboxUpdate, expectedOwnerId?: string): Promise<OutboxOperation | null>;
  owner(): Promise<string | null>;
  importLegacyVault(ownerId: string, raw: string, options: LegacyVaultImportOptions): Promise<boolean>;
  transitionOwner(expectedOwnerId: string | null, targetOwnerId: string | null): Promise<void>;
  removeSynced(): Promise<void>;
  clear(): Promise<void>;
  replaceAll(operations: OutboxOperation[]): Promise<void>;
}

type PersistedOutbox = {
  version: 1;
  operations: unknown[];
};

type LegacyGlobalRecovery = { raw: string; ownerId: string | null };

type KeyValueOutboxState = {
  version: 2;
  ownerId: string | null;
  operations: OutboxOperation[];
  vaults: Record<string, OutboxOperation[]>;
  // A durable receipt permits cleanup retry without reactivating synced intents.
  legacyGlobalRecovery?: LegacyGlobalRecovery;
};

export type OutboxStoreOptions = {
  indexedDB?: IDBFactory;
  databaseName?: string;
  transitionHook?: (point: ScopeTransitionPoint) => void;
};

type ChangedOptions = {
  tolerateCommittedOwnerChange?: boolean;
  tolerateRefreshFailure?: boolean;
};

const KEY = 'operations';
const NAMESPACE = 'pharmacystock:outbox:v1';
const KEY_VALUE_STATE_KEY = 'pharmacystock:outbox:v2:key-value-state';
const LEGACY_OWNER_KEY = 'pharmacystock:offline-scope:v1:user-id';
const UNOWNED_VAULT = '__unowned__';
const CHANGE_CHANNEL = 'pharmacystock:outbox:v2:changes';
const fallbackListeners = new Set<() => void>();
const storageQueues = new WeakMap<KeyValueStorage, Promise<void>>();

function sortOperations(operations: OutboxOperation[]) {
  return [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function immutableOutboxContentMatches(left: OutboxOperation, right: OutboxOperation): boolean {
  const immutableContent = (operation: OutboxOperation) => ({
    kind: operation.kind,
    organizationId: operation.organizationId,
    branchId: operation.branchId ?? null,
    payload: operation.payload,
  });
  return stableSerialize(immutableContent(left)) === stableSerialize(immutableContent(right));
}

function parsePersisted(raw: string | null): OutboxOperation[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedOutbox;
    if (parsed.version !== 1 || !Array.isArray(parsed.operations)
      || !parsed.operations.every(isRecoverableLegacyOperation)) return null;
    return sortOperations(parsed.operations);
  } catch {
    return null;
  }
}

function parseVault(raw: string): OutboxOperation[] | null {
  try {
    const parsed = JSON.parse(raw) as { operations?: unknown };
    if (!Array.isArray(parsed.operations) || !parsed.operations.every(isRecoverableLegacyOperation)) return null;
    return sortOperations(parsed.operations);
  } catch {
    return null;
  }
}

function operationsMatch(left: OutboxOperation, right: OutboxOperation): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

class KeyValueOutboxPersistence implements OutboxPersistence {
  readonly supportsCrossContextAtomicity = false;
  private readonly legacyNamespaced;
  private observedOwnerId: string | null | undefined;

  constructor(private readonly storage: KeyValueStorage) {
    this.legacyNamespaced = createNamespacedStorage(NAMESPACE, storage);
  }

  async list(expectedOwnerId?: string): Promise<OutboxOperation[]> {
    let operations: OutboxOperation[] = [];
    await this.runExclusive(() => {
      const state = this.readState();
      this.assertOwner(state, expectedOwnerId);
      this.observedOwnerId = state.ownerId;
      operations = state.operations;
    });
    return sortOperations(operations);
  }

  listSync(): OutboxOperation[] {
    const state = this.readState();
    return this.observedOwnerId === state.ownerId ? sortOperations(state.operations) : [];
  }

  enqueue(
    operation: OutboxOperation,
    expectedOwnerId?: string,
    validate?: OutboxEnqueueValidator,
  ): Promise<OutboxOperation> {
    return this.mutate((state) => {
      this.assertOwner(state, expectedOwnerId);
      const duplicate = state.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
      if (duplicate && !immutableOutboxContentMatches(duplicate, operation)) {
        throw new OutboxIdempotencyConflictError(operation.idempotencyKey);
      }
      if (!duplicate) validate?.(state.operations);
      return {
        state: duplicate ? state : { ...state, operations: [...state.operations, operation] },
        result: duplicate ?? operation,
      };
    });
  }

  update(id: string, patch: OutboxUpdate, expectedOwnerId?: string): Promise<OutboxOperation | null> {
    return this.mutate((state) => {
      this.assertOwner(state, expectedOwnerId);
      let updated: OutboxOperation | null = null;
      const operations = state.operations.map((item) => {
        if (item.id !== id) return item;
        updated = { ...item, ...patch };
        return updated;
      });
      return { state: { ...state, operations }, result: updated };
    });
  }

  owner(): Promise<string | null> {
    let ownerId: string | null = null;
    return this.runExclusive(() => {
      ownerId = this.readState().ownerId;
    }).then(() => ownerId);
  }

  importLegacyVault(
    ownerId: string,
    raw: string,
    options: LegacyVaultImportOptions,
  ): Promise<boolean> {
    let complete = false;
    return this.runExclusive(() => {
      if (!options.ownershipProven) return;
      const imported = parseVault(raw);
      if (!imported) return;
      const state = this.readState();
      const destination = state.ownerId === ownerId
        ? state.operations
        : state.vaults[ownerId] ?? [];
      const merged = [...destination];

      for (const operation of imported.map(resetInterruptedReplay)) {
        const duplicateByKey = merged.find((item) => item.idempotencyKey === operation.idempotencyKey);
        const duplicateById = merged.find((item) => item.id === operation.id);
        if (duplicateByKey) {
          if (!immutableOutboxContentMatches(duplicateByKey, operation)) return;
          continue;
        }
        if (duplicateById) {
          if (!operationsMatch(duplicateById, operation)) return;
          continue;
        }
        merged.push(operation);
      }

      const next = state.ownerId === ownerId
        ? { ...state, operations: sortOperations(merged) }
        : { ...state, vaults: { ...state.vaults, [ownerId]: sortOperations(merged) } };
      this.writeState(next);
      complete = true;
    }).then(() => complete);
  }

  transitionOwner(expectedOwnerId: string | null, targetOwnerId: string | null): Promise<void> {
    return this.runExclusive(() => {
      const state = this.readState();
      this.assertOwner(state, expectedOwnerId);
      if (state.ownerId === targetOwnerId) return;

      const vaults = { ...state.vaults };
      const retained = state.operations.filter((operation) => operation.status !== 'SYNCED');
      if (state.ownerId) vaults[state.ownerId] = retained;
      else if (retained.length > 0) vaults[UNOWNED_VAULT] = retained;

      const restored = targetOwnerId
        ? (vaults[targetOwnerId] ?? []).map(resetInterruptedReplay)
        : [];
      if (targetOwnerId) delete vaults[targetOwnerId];
      this.writeState({
        ...state,
        ownerId: targetOwnerId,
        operations: restored,
        vaults,
      });
    });
  }

  removeSynced(): Promise<void> {
    return this.mutate((state) => ({
      state: { ...state, operations: state.operations.filter((item) => item.status !== 'SYNCED') },
      result: undefined,
    }));
  }

  clear(): Promise<void> {
    return this.mutate((state) => ({ state: { ...state, operations: [] }, result: undefined }));
  }

  replaceAll(operations: OutboxOperation[]): Promise<void> {
    return this.mutate((state) => ({
      state: { ...state, operations: sortOperations(operations) },
      result: undefined,
    }));
  }

  private async mutate<TResult>(
    mutation: (state: KeyValueOutboxState) => { state: KeyValueOutboxState; result: TResult },
  ): Promise<TResult> {
    let result!: TResult;
    await this.runExclusive(() => {
      const next = mutation(this.readState());
      this.writeState(next.state);
      result = next.result;
    });
    return result;
  }

  private runExclusive(action: () => void): Promise<void> {
    const previous = storageQueues.get(this.storage) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    storageQueues.set(this.storage, next.catch(() => undefined));
    return next;
  }

  private assertOwner(state: KeyValueOutboxState, expectedOwnerId?: string | null): void {
    if (expectedOwnerId === undefined || state.ownerId === expectedOwnerId) return;
    throw new OutboxOwnerMismatchError(expectedOwnerId, state.ownerId);
  }

  private readState(): KeyValueOutboxState {
    const raw = this.storage.getItem(KEY_VALUE_STATE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<KeyValueOutboxState>;
        if (parsed.version === 2
          && (typeof parsed.ownerId === 'string' || parsed.ownerId === null)
          && Array.isArray(parsed.operations)
          && parsed.vaults
          && typeof parsed.vaults === 'object') {
          return {
            version: 2,
            ownerId: parsed.ownerId,
            operations: sortOperations(parsed.operations),
            legacyGlobalRecovery: this.parseRecoveryReceipt(parsed.legacyGlobalRecovery),
            vaults: Object.fromEntries(Object.entries(parsed.vaults).map(([ownerId, operations]) => [
              ownerId,
              Array.isArray(operations) ? sortOperations(operations) : [],
            ])),
          };
        }
      } catch {
        // Fall back to the retained v1 snapshot rather than exposing a corrupt v2 state.
      }
    }

    const legacyRaw = this.legacyNamespaced.get(KEY);
    const ownerId = this.storage.getItem(LEGACY_OWNER_KEY);
    const operations = parsePersisted(legacyRaw);
    return {
      version: 2,
      ownerId,
      operations: operations ?? [],
      vaults: {},
      legacyGlobalRecovery: operations !== null && legacyRaw !== null
        ? { raw: legacyRaw, ownerId }
        : undefined,
    };
  }

  private parseRecoveryReceipt(value: unknown): LegacyGlobalRecovery | undefined {
    if (value === null || typeof value !== 'object' || !('raw' in value) || !('ownerId' in value)) return;
    if (typeof value.raw !== 'string' || (value.ownerId !== null && typeof value.ownerId !== 'string')
      || parsePersisted(value.raw) === null) return;
    return { raw: value.raw, ownerId: value.ownerId };
  }

  private writeState(state: KeyValueOutboxState): void {
    const normalized: KeyValueOutboxState = {
      ...state,
      operations: sortOperations(state.operations),
      vaults: Object.fromEntries(Object.entries(state.vaults).map(([ownerId, operations]) => [
        ownerId,
        sortOperations(operations),
      ])),
    };
    // Owner, active operations and per-user vaults share one authoritative
    // record. A synchronous key/value replacement plus the shared queue makes
    // owner verification and mutation one serialized commit on native.
    this.storage.setItem(KEY_VALUE_STATE_KEY, JSON.stringify(normalized));

    // Only a consumed, fully validated snapshot can be cleaned up. The receipt
    // survives restart/cleanup failure; a later v2 write must not erase a source
    // that never contributed to this state or was replaced during the commit.
    try {
      const recovered = normalized.legacyGlobalRecovery;
      if (recovered && this.storage.getItem(LEGACY_OWNER_KEY) === recovered.ownerId
        && this.legacyNamespaced.get(KEY) === recovered.raw) {
        this.legacyNamespaced.remove(KEY);
      }
      // Retained raw data must keep its original owner (including ownerless).
      // The v2 record already carries the current active owner independently.
      if (this.legacyNamespaced.get(KEY) === null) {
        if (normalized.ownerId) this.storage.setItem(LEGACY_OWNER_KEY, normalized.ownerId);
        else this.storage.removeItem(LEGACY_OWNER_KEY);
      }
    } catch {
      // The committed v2 record remains authoritative and cleanup is retryable.
    }
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
      ? new IndexedDbOutboxPersistence(indexedDB, legacyStorage, options.databaseName, options.transitionHook)
      : new KeyValueOutboxPersistence(legacyStorage);
    this.channel = indexedDB && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(CHANGE_CHANNEL)
      : null;
    if (this.channel) {
      this.channel.onmessage = () => this.notify();
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

  async refresh(expectedOwnerId?: string): Promise<OutboxOperation[]> {
    await this.initialization;
    try {
      await this.load(expectedOwnerId);
    } catch (error) {
      if (error instanceof OutboxOwnerMismatchError) this.operations = [];
      throw error;
    }
    return this.list();
  }

  async enqueue<TPayload>(
    operation: Omit<OutboxOperation<TPayload>, 'status' | 'attemptCount'>,
    expectedOwnerId?: string,
    options: OutboxEnqueueOptions = {},
  ): Promise<OutboxOperation<TPayload>> {
    await this.initialization;
    if (options.requireCrossContextAtomicity && !this.persistence.supportsCrossContextAtomicity) {
      throw new OutboxAtomicCoordinationUnavailableError();
    }
    const next: OutboxOperation<TPayload> = { ...operation, status: 'PENDING', attemptCount: 0 };
    const persisted = await this.persistence.enqueue(next, expectedOwnerId, options.validate);
    // Persistence has committed at this point. Cache refresh and notifications
    // are best-effort bookkeeping and must not turn durable success into a
    // caller-visible enqueue failure.
    await this.changed(expectedOwnerId, {
      tolerateCommittedOwnerChange: true,
      tolerateRefreshFailure: true,
    });
    return persisted as OutboxOperation<TPayload>;
  }

  async update(id: string, patch: OutboxUpdate, expectedOwnerId?: string): Promise<OutboxOperation | null> {
    await this.initialization;
    const updated = await this.persistence.update(id, patch, expectedOwnerId);
    if (updated) await this.changed(expectedOwnerId);
    return updated;
  }

  pending(now = new Date(), staleSyncingAfterMs = OUTBOX_STALE_SYNCING_AFTER_MS): OutboxOperation[] {
    const nowMs = now.getTime();
    return this.list().filter((item) => {
      const eligibleAt = outboxReplayEligibleAt(item, staleSyncingAfterMs);
      return eligibleAt !== null && eligibleAt <= nowMs;
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

  async owner(): Promise<string | null> {
    await this.initialization;
    return this.persistence.owner();
  }

  async transitionOwner(expectedOwnerId: string | null, targetOwnerId: string | null): Promise<void> {
    await this.initialization;
    await this.persistence.transitionOwner(expectedOwnerId, targetOwnerId);
    await this.changed();
  }

  async importLegacyVault(
    ownerId: string,
    raw: string,
    options: LegacyVaultImportOptions,
  ): Promise<boolean> {
    await this.initialization;
    const complete = await this.persistence.importLegacyVault(ownerId, raw, options);
    await this.changed();
    return complete;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.channel) fallbackListeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      fallbackListeners.delete(listener);
    };
  }

  private async load(expectedOwnerId?: string): Promise<void> {
    this.operations = await this.persistence.list(expectedOwnerId);
  }

  private async changed(expectedOwnerId?: string, options: ChangedOptions = {}): Promise<void> {
    try {
      await this.load(expectedOwnerId);
    } catch (error) {
      if (error instanceof OutboxOwnerMismatchError) {
        // Enqueue durability wins once its transaction commits: callers may
        // clear the cart even if another tab immediately switches owners and
        // vaults the operation. Replay updates do not tolerate this condition,
        // so their handler stops before another server call can begin.
        this.operations = [];
        if (!options.tolerateCommittedOwnerChange) throw error;
      } else {
        if (!options.tolerateRefreshFailure) throw error;
        // A failed reload leaves ownership and active contents uncertain. Keep
        // the in-memory view empty until a later explicit refresh succeeds.
        this.operations = [];
      }
    }
    if (this.channel) {
      this.notify();
      try {
        this.channel.postMessage({ changed: true });
      } catch {
        // The durable mutation already committed; cross-tab notification is
        // advisory and later reads will recover the authoritative state.
      }
    } else {
      notifyListeners(fallbackListeners);
    }
  }

  private notify(): void {
    notifyListeners(this.listeners);
  }
}

function notifyListeners(listeners: Iterable<() => void>): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Subscribers are observers. Their failure cannot change the outcome of
      // a mutation that has already committed to durable persistence.
    }
  }
}

export function createOutboxId(prefix: string, now = Date.now(), random = Math.random()) {
  return `${prefix}:${now.toString(36)}:${Math.floor(random * 1_000_000_000).toString(36)}`;
}
