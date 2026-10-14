import { IndexedDbOutboxPersistence } from './outboxIndexedDb';
import {
  classifyOutboxReceiptEvidence, classifyOutboxRecoveryGroups, classifyOutboxRecoverySource, immutableOutboxContentMatches, OUTBOX_DISPATCH_BLOCKED_CODE, KEY_VALUE_OUTBOX_STATE_KEY as KEY_VALUE_STATE_KEY,
  isRecoverableLegacyOperation, orderOutboxRecoveryRecords, parseOutboxRecoverySource, parseOutboxTimestamp, scopedOutboxQuarantineEvidence, retainScopedOutboxQuarantine, outboxEvidenceBlockedKeys,
  resetInterruptedReplay, stableOutboxSerialize,
  isOutboxReceiptMap, mergeOutboxEvidence, outboxOperationEvidence, retainedOutboxReceiptEvidence, scopedOutboxReceiptEvidence, visibleLegacyOutboxEvidence, legacyOutboxVaultKey, LEGACY_USER_IMPORT_PREFIX,
  type OutboxEvidence, storedOutboxIdempotencyKey, outboxWitnessEvidence,
} from './outboxRecovery';
import { createNamespacedStorage, getLocalStorage, type KeyValueStorage } from './storage';

export { immutableOutboxContentMatches } from './outboxRecovery';

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
  if (!isRecoverableLegacyOperation(operation)) return null;
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
  list(expectedOwnerId?: string | null): Promise<OutboxOperation[]>;
  listSync?(): OutboxOperation[];
  enqueue(
    operation: OutboxOperation,
    expectedOwnerId?: string,
    validate?: OutboxEnqueueValidator,
  ): Promise<OutboxOperation>;
  update(id: string, patch: OutboxUpdate, expectedOwnerId?: string | null, expectedOperation?: OutboxOperation): Promise<OutboxOperation | null>;
  dispatchIfAuthoritative(operation: OutboxOperation, ownerId: string, canDispatch: () => boolean, dispatch: () => void): Promise<boolean>;
  owner(): Promise<string | null>;
  importLegacyVault(ownerId: string, raw: string, options: LegacyVaultImportOptions): Promise<boolean>;
  cleanupLegacyVault(ownerId: string, raw: string, expectedOwnerId: string | null): Promise<boolean>;
  transitionOwner(expectedOwnerId: string | null, targetOwnerId: string | null): Promise<void>;
  removeSynced(): Promise<void>;
  clear(): Promise<void>;
  replaceAll(operations: OutboxOperation[]): Promise<void>;
}

type KeyValueOutboxState = {
  version: 2;
  ownerId: string | null;
  operations: OutboxOperation[];
  vaults: Record<string, OutboxOperation[]>;
  quarantine?: unknown;
  // A durable receipt permits cleanup retry without reactivating synced intents.
  legacyGlobalRecovery?: unknown;
  legacyVaultReceipts?: unknown;
  legacyVaultReceiptArchives?: unknown;
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
const LEGACY_OWNER_KEY = 'pharmacystock:offline-scope:v1:user-id';
const UNOWNED_VAULT = '__unowned__';
const CHANGE_CHANNEL = 'pharmacystock:outbox:v2:changes';
const fallbackListeners = new Set<() => void>();
const storageQueues = new WeakMap<KeyValueStorage, Promise<void>>();

function sortOperations(operations: OutboxOperation[]) {
  return [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function parsePersisted(raw: string | null): OutboxOperation[] | null {
  if (raw === null) return null;
  const parsed = parseOutboxRecoverySource(raw, 1);
  const recovery = classifyOutboxRecoverySource(parsed.records, []);
  return parsed.validContainer && recovery.complete ? recovery.operations : null;
}

function operationsMatch(left: OutboxOperation, right: OutboxOperation): boolean {
  return stableOutboxSerialize(left) === stableOutboxSerialize(right);
}

function keyValueHistoricalEvidence(state: KeyValueOutboxState, ownerId: string | null): OutboxEvidence {
  const global = classifyOutboxReceiptEvidence(state.legacyGlobalRecovery);
  // Foreign slots supply inherited ownership, never candidate admission or
  // completion history. Recognized explicitly re-owned children still count as
  // current immutable evidence, even inside a valid foreign envelope.
  const foreignVaults = Object.entries(state.vaults).filter(([storedOwner]) => storedOwner !== ownerId)
    .map(([storedOwner, rows]) => {
      const inheritedOwner = storedOwner.trim() ? storedOwner : undefined;
      return outboxWitnessEvidence(rows, ownerId, inheritedOwner === undefined, inheritedOwner);
    });
  return mergeOutboxEvidence(
    ...foreignVaults,
    global.ownerId === ownerId || global.ownerId === undefined ? global : scopedOutboxQuarantineEvidence(state.legacyGlobalRecovery, ownerId),
    scopedOutboxReceiptEvidence(state.legacyVaultReceipts, ownerId),
    retainedOutboxReceiptEvidence(state.legacyVaultReceiptArchives, ownerId),
    scopedOutboxQuarantineEvidence(state.quarantine, ownerId),
  );
}

function normalizeKeyValueState(state: KeyValueOutboxState): KeyValueOutboxState {
  let quarantine = state.quarantine;
  const vaults = { ...state.vaults };
  let operations: OutboxOperation[] = [];
  const receipt = classifyOutboxReceiptEvidence(state.legacyGlobalRecovery);
  const owners = new Set<string | null>([state.ownerId, ...Object.keys(vaults)]);
  if (receipt.ownerId !== undefined) owners.add(receipt.ownerId);
  for (const ownerId of owners) {
    const active = ownerId === state.ownerId ? state.operations : [];
    const vaulted = ownerId === null ? [] : vaults[ownerId] ?? [];
    const evidence = mergeOutboxEvidence(keyValueHistoricalEvidence(state, ownerId), outboxOperationEvidence([...active, ...vaulted], ownerId));
    const blocked = outboxEvidenceBlockedKeys(evidence, [...active, ...vaulted]);
    const recovery = classifyOutboxRecoveryGroups([
      ...orderOutboxRecoveryRecords(active), ...orderOutboxRecoveryRecords(vaulted),
      ...orderOutboxRecoveryRecords(evidence?.records ?? []),
    ], blocked);
    // Historical evidence stays in its original receipt. Quarantine destination
    // members, without copying lifecycle variants of the same witness into it.
    const rejected = recovery.rejected.filter(({ record }) => active.includes(record as OutboxOperation) || vaulted.includes(record as OutboxOperation));
    quarantine = retainScopedOutboxQuarantine(quarantine, ownerId, rejected);
    if (ownerId === state.ownerId) operations = recovery.operations.filter((item) => active.includes(item));
    if (ownerId !== null && Object.prototype.hasOwnProperty.call(vaults, ownerId)) {
      vaults[ownerId] = recovery.operations.filter((item) => vaulted.includes(item));
    }
  }
  const normalized = { ...state, operations, vaults, ...(quarantine !== undefined ? { quarantine } : {}) };
  return stableOutboxSerialize(normalized) === stableOutboxSerialize(state) ? state : normalized;
}

function keyValueBlockedKeys(state: KeyValueOutboxState, ownerId: string | null): Set<string> {
  return outboxEvidenceBlockedKeys(scopedOutboxQuarantineEvidence(state.quarantine, ownerId), [
    ...(state.ownerId === ownerId ? state.operations : []), ...(ownerId === null ? [] : state.vaults[ownerId] ?? []),
  ]);
}

function classifyKeyValueRecoverySource(state: KeyValueOutboxState, ownerId: string | null, records: unknown[], visible: OutboxEvidence = { records: [], blockedKeys: new Set() }) {
  const destination = [
    ...(state.ownerId === ownerId ? state.operations : []),
    ...(ownerId === null ? [] : state.vaults[ownerId] ?? []),
  ];
  const evidence = mergeOutboxEvidence(keyValueHistoricalEvidence(state, ownerId), visible, outboxOperationEvidence([...destination, ...records], ownerId));
  const blocked = keyValueBlockedKeys(state, ownerId);
  for (const key of outboxEvidenceBlockedKeys(evidence, [...destination, ...records])) blocked.add(key);
  const recovery = classifyOutboxRecoverySource(records, [...destination, ...(evidence?.records ?? [])], blocked);
  // Source-only invalid work remains at its raw source. Live witnesses must
  // not masquerade as destination rows and cause unrelated storage writes.
  const destinationKeys = new Set([...destination, ...keyValueHistoricalEvidence(state, ownerId).records]
    .flatMap((item) => { const key = storedOutboxIdempotencyKey(item); return key === undefined ? [] : [key]; }));
  const disputed = recovery.disputed.filter(({ record }) => {
    const key = storedOutboxIdempotencyKey(record);
    return key !== undefined && destinationKeys.has(key);
  });
  if (!disputed.length) return { state, recovery };
  const quarantine = retainScopedOutboxQuarantine(state.quarantine, ownerId, disputed);
  return { state: normalizeKeyValueState({ ...state, quarantine }), recovery };
}

class KeyValueOutboxPersistence implements OutboxPersistence {
  readonly supportsCrossContextAtomicity = false;
  private readonly legacyNamespaced;
  private observedOwnerId: string | null | undefined;

  constructor(private readonly storage: KeyValueStorage) {
    this.legacyNamespaced = createNamespacedStorage(NAMESPACE, storage);
  }

  async list(expectedOwnerId?: string | null): Promise<OutboxOperation[]> {
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

  async dispatchIfAuthoritative(expected: OutboxOperation, ownerId: string, canDispatch: () => boolean, dispatch: () => void): Promise<boolean> {
    // This queue cannot coordinate localStorage writers in another browser tab.
    // React Native also defines window; a browser DOM identifies this fallback.
    if (typeof document !== 'undefined') {
      await this.runExclusive(() => {
        const state = this.readState();
        const current = state.operations.find((item) => item.id === expected.id);
        if (state.ownerId !== ownerId || !current || current.status !== 'SYNCING'
          || !isRecoverableLegacyOperation(current) || !operationsMatch(current, expected) || !canDispatch()) return;
        this.writeState({ ...state, operations: state.operations.map((item) => item === current
          ? { ...item, lastErrorCode: OUTBOX_DISPATCH_BLOCKED_CODE } : item) });
      });
      return false;
    }
    let dispatched = false;
    await this.runExclusive(() => {
      const state = this.readState();
      const current = state.operations.find((item) => item.id === expected.id);
      if (state.ownerId !== ownerId || keyValueBlockedKeys(state, ownerId).has(expected.idempotencyKey)
        || !current || !isRecoverableLegacyOperation(current) || current.status !== 'SYNCING'
        || !operationsMatch(current, expected) || !canDispatch()) return;
      // Do not return/await the network promise from this serialized action.
      dispatch();
      dispatched = true;
    });
    return dispatched;
  }

  enqueue(
    operation: OutboxOperation,
    expectedOwnerId?: string,
    validate?: OutboxEnqueueValidator,
  ): Promise<OutboxOperation> {
    return this.mutate((state) => {
      this.assertOwner(state, expectedOwnerId);
      if (keyValueBlockedKeys(state, state.ownerId).has(operation.idempotencyKey)) {
        throw new OutboxIdempotencyConflictError(operation.idempotencyKey);
      }
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

  update(id: string, patch: OutboxUpdate, expectedOwnerId?: string | null, expectedOperation?: OutboxOperation): Promise<OutboxOperation | null> {
    return this.mutate((state) => {
      this.assertOwner(state, expectedOwnerId);
      let updated: OutboxOperation | null = null;
      const operations = state.operations.map((item) => {
        if (item.id !== id || (expectedOperation && !operationsMatch(item, expectedOperation))) return item;
        updated = { ...item, ...patch };
        return updated;
      });
      return { state: { ...state, operations }, result: updated };
    });
  }

  owner(): Promise<string | null> {
    let ownerId: string | null = null;
    return this.runExclusive(() => {
      ownerId = this.readState(false).ownerId;
    }).then(() => ownerId);
  }

  importLegacyVault(
    ownerId: string,
    raw: string,
    options: LegacyVaultImportOptions,
  ): Promise<boolean> {
    let complete = false;
    return this.runExclusive(() => {
      const parsed = parseOutboxRecoverySource(raw);
      if (!parsed.validContainer) return;
      const current = this.readState();
      const checked = classifyKeyValueRecoverySource(current, ownerId, parsed.records, visibleLegacyOutboxEvidence(this.storage, ownerId));
      const state = checked.state;
      if (state !== current) this.writeState(state);
      // Ownership proof still gates activation/cleanup. A disputed key cannot
      // leave an already-owned destination replayable while proof is pending.
      if (!options.ownershipProven || !checked.recovery.complete) return;
      const imported = checked.recovery.operations;
      const destination = state.ownerId === ownerId
        ? state.operations
        : state.vaults[ownerId] ?? [];
      const merged = [...destination];
      const priorReceipts = state.legacyVaultReceipts;
      const receiptMap = isOutboxReceiptMap(priorReceipts);
      const archives = Array.isArray(state.legacyVaultReceiptArchives) ? [...state.legacyVaultReceiptArchives]
        : state.legacyVaultReceiptArchives === undefined ? [] : [state.legacyVaultReceiptArchives];
      if (priorReceipts !== undefined && !receiptMap) archives.push(priorReceipts);
      const receipts: Record<string, unknown> = receiptMap ? { ...priorReceipts as Record<string, unknown> } : {};
      for (const source of imported) {
        const operation = resetInterruptedReplay(source);
        const encoded = JSON.stringify([ownerId, operation.idempotencyKey]);
        const key = `${LEGACY_USER_IMPORT_PREFIX}${encoded}`;
        // Joint classification already proved immutable agreement. A valid
        // historical receipt with an absent destination is consumed, not new work.
        if (receipts[encoded] !== undefined) {
          if (!classifyOutboxReceiptEvidence(receipts[encoded], { key, idempotencyKey: operation.idempotencyKey, ownerId }).valid) return;
          continue;
        }
        const duplicateByKey = merged.find((item) => item.idempotencyKey === operation.idempotencyKey);
        const duplicateById = merged.find((item) => item.id === operation.id);
        if (duplicateByKey) {
          if (!immutableOutboxContentMatches(duplicateByKey, operation)) return;
          receipts[encoded] = { key, sourceFingerprint: stableOutboxSerialize(source), importedId: duplicateByKey.id };
          continue;
        }
        if (duplicateById) {
          if (!operationsMatch(duplicateById, operation)) return;
          receipts[encoded] = { key, sourceFingerprint: stableOutboxSerialize(source), importedId: duplicateById.id };
          continue;
        }
        const historicalId = keyValueHistoricalEvidence(state, ownerId).importedIds?.get(operation.idempotencyKey);
        if (!historicalId) merged.push(operation);
        receipts[encoded] = { key, sourceFingerprint: stableOutboxSerialize(source), importedId: historicalId ?? operation.id };
      }

      const retainedState = archives.length ? { ...state, legacyVaultReceiptArchives: archives } : state;
      const next = state.ownerId === ownerId
        ? { ...retainedState, legacyVaultReceipts: receipts, operations: sortOperations(merged) }
        : { ...retainedState, legacyVaultReceipts: receipts, vaults: { ...state.vaults, [ownerId]: sortOperations(merged) } };
      this.writeState(next);
      complete = true;
    }).then(() => complete);
  }

  cleanupLegacyVault(ownerId: string, raw: string, expectedOwnerId: string | null): Promise<boolean> {
    let cleaned = false;
    return this.runExclusive(() => {
      const state = this.readState();
      if (state.ownerId !== expectedOwnerId) return;
      const source = parseOutboxRecoverySource(raw);
      const checked = classifyKeyValueRecoverySource(state, ownerId, source.records, visibleLegacyOutboxEvidence(this.storage, ownerId));
      if (checked.state !== state) this.writeState(checked.state);
      if (!source.validContainer || !checked.recovery.complete) return;
      const receipts = state.legacyVaultReceipts;
      if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts)) return;
      for (const operation of checked.recovery.operations) {
        const encoded = JSON.stringify([ownerId, operation.idempotencyKey]);
        const evidence = classifyOutboxReceiptEvidence((receipts as Record<string, unknown>)[encoded], {
          key: `${LEGACY_USER_IMPORT_PREFIX}${encoded}`, idempotencyKey: operation.idempotencyKey, ownerId,
        });
        if (!evidence.valid || !classifyOutboxRecoveryGroups([operation, ...evidence.records], evidence.blockedKeys).complete) return;
      }
      // The exact source, owner check and remove invocation share the native
      // mutation queue; no asynchronous gap can trust the earlier import result.
      const key = legacyOutboxVaultKey(ownerId);
      if (this.storage.getItem(key) !== raw) return;
      try { this.storage.removeItem(key); cleaned = true; } catch { /* Durable import stays successful; source retries later. */ }
    }).then(() => cleaned);
  }

  transitionOwner(expectedOwnerId: string | null, targetOwnerId: string | null): Promise<void> {
    return this.runExclusive(() => {
      const state = this.readState();
      this.assertOwner(state, expectedOwnerId);
      if (state.ownerId === targetOwnerId) {
        this.writeState(state);
        return;
      }

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
      state: { ...state, operations },
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

  private readState(reconcileVisible = true): KeyValueOutboxState {
    const raw = this.storage.getItem(KEY_VALUE_STATE_KEY);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as Partial<KeyValueOutboxState>;
        if (parsed.version === 2
          && (typeof parsed.ownerId === 'string' || parsed.ownerId === null)
          && Array.isArray(parsed.operations)
          && parsed.vaults
          && typeof parsed.vaults === 'object'
          && !Array.isArray(parsed.vaults)
          && Object.values(parsed.vaults).every(Array.isArray)) {
          const storedState: KeyValueOutboxState = {
            version: 2,
            ownerId: parsed.ownerId,
            operations: parsed.operations,
            legacyGlobalRecovery: parsed.legacyGlobalRecovery,
            legacyVaultReceipts: parsed.legacyVaultReceipts,
            legacyVaultReceiptArchives: parsed.legacyVaultReceiptArchives,
            quarantine: parsed.quarantine,
            vaults: Object.fromEntries(Object.entries(parsed.vaults).map(([ownerId, operations]) => [
              ownerId,
              operations,
            ])),
          };
          const state = normalizeKeyValueState(storedState);
          const reconciled = reconcileVisible ? this.reconcileRecoverySources(state) : state;
          // Disputed destination state must be durably quarantined before it
          // can be exposed, even when recovery never imports a source member.
          if (reconciled !== state || (state !== storedState && (storedState.legacyGlobalRecovery !== undefined || storedState.legacyVaultReceipts !== undefined || (storedState.quarantine !== undefined && state.quarantine !== storedState.quarantine)))) {
            this.writeState(reconciled);
          }
          return reconciled;
        }
      } catch {
        // Never overwrite unpreserved v2 data with a legacy fallback.
      }
      throw new Error('OUTBOX_STORAGE_INVALID');
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

  private parseRecoveryReceipt(value: unknown): { raw: string; ownerId: string | null } | undefined {
    return classifyOutboxReceiptEvidence(value).valid
      ? value as { raw: string; ownerId: string | null } : undefined;
  }

  private reconcileRecoverySources(state: KeyValueOutboxState): KeyValueOutboxState {
    const owners = new Set<string | null>([state.ownerId, ...Object.keys(state.vaults)]);
    const globalOwner = this.storage.getItem(LEGACY_OWNER_KEY);
    owners.add(globalOwner);
    for (const ownerId of owners) {
      const visible = visibleLegacyOutboxEvidence(this.storage, ownerId);
      state = classifyKeyValueRecoverySource(state, ownerId, visible.records, { ...visible, records: [] }).state;
    }
    // Normalization includes valid and malformed-keyed historical evidence.
    // Preserve the original receipt object across every subsequent v2 write.
    state = normalizeKeyValueState(state);
    return state;
  }

  private writeState(state: KeyValueOutboxState): void {
    const normalized = this.reconcileRecoverySources(normalizeKeyValueState(state));
    // Owner, active operations and per-user vaults share one authoritative
    // record. A synchronous key/value replacement plus the shared queue makes
    // owner verification and mutation one serialized commit on native.
    this.storage.setItem(KEY_VALUE_STATE_KEY, JSON.stringify(normalized));

    // Only a consumed, fully validated snapshot can be cleaned up. The receipt
    // survives restart/cleanup failure; a later v2 write must not erase a source
    // that never contributed to this state or was replaced during the commit.
    try {
      const recovered = this.parseRecoveryReceipt(normalized.legacyGlobalRecovery);
      const source = recovered ? parseOutboxRecoverySource(recovered.raw, 1) : null;
      const compatible = recovered && source ? classifyKeyValueRecoverySource(normalized, recovered.ownerId, source.records).recovery : null;
      if (recovered && source?.validContainer && compatible?.complete
        && this.storage.getItem(LEGACY_OWNER_KEY) === recovered.ownerId
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

  async refresh(expectedOwnerId?: string | null): Promise<OutboxOperation[]> {
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

  // With an expected operation, null means absent or changed at the durable commit.
  // Replay must not dispatch or apply a result when this conditional update fails.
  async update(id: string, patch: OutboxUpdate, expectedOwnerId?: string | null, expectedOperation?: OutboxOperation): Promise<OutboxOperation | null> {
    await this.initialization;
    const updated = await this.persistence.update(id, patch, expectedOwnerId, expectedOperation);
    if (updated) await this.changed(expectedOwnerId);
    return updated;
  }

  async dispatchIfAuthoritative(operation: OutboxOperation, ownerId: string, canDispatch: () => boolean, dispatch: () => void): Promise<boolean> {
    await this.initialization;
    const started = await this.persistence.dispatchIfAuthoritative(operation, ownerId, canDispatch, dispatch);
    if (!started && this.persistence.listSync && typeof document !== 'undefined') {
      // The blocked error was committed by the key/value guard. Publish it via
      // existing subscriptions so the status banner need not wait for a retry.
      await this.changed(ownerId, { tolerateCommittedOwnerChange: true, tolerateRefreshFailure: true });
    }
    return started;
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

  async cleanupLegacyVault(ownerId: string, raw: string, expectedOwnerId: string | null): Promise<boolean> {
    await this.initialization;
    const cleaned = await this.persistence.cleanupLegacyVault(ownerId, raw, expectedOwnerId);
    await this.changed();
    return cleaned;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.channel) fallbackListeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      fallbackListeners.delete(listener);
    };
  }

  private async load(expectedOwnerId?: string | null): Promise<void> {
    this.operations = await this.persistence.list(expectedOwnerId);
  }

  private async changed(expectedOwnerId?: string | null, options: ChangedOptions = {}): Promise<void> {
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
