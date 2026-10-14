import type { KeyValueStorage } from './storage';
import type { OutboxOperation } from './outbox';

// Keep PR #88's timestamp semantics identical at recovery and replay boundaries.
export function parseOutboxTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function nonblankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isRecoverableLegacyOperation(value: unknown): value is OutboxOperation {
  if (!record(value)) return false;
  // SALE is the only currently queued/replayed kind. Its scope is branch-bound.
  // This checks the stored envelope, not sale lines, quantities or payments.
  if (value.kind !== 'SALE'
    || !nonblankString(value.id)
    || !nonblankString(value.idempotencyKey)
    || !nonblankString(value.organizationId)
    || !nonblankString(value.branchId)
    || !record(value.payload)
    || !Object.prototype.hasOwnProperty.call(value, 'payload')
    || typeof value.status !== 'string'
    || !['PENDING', 'SYNCING', 'SYNCED', 'CONFLICT', 'FAILED'].includes(value.status)
    || typeof value.attemptCount !== 'number'
    || !Number.isSafeInteger(value.attemptCount)
    || value.attemptCount < 0
    || parseOutboxTimestamp(value.createdAt) === null) return false;

  // If the payload duplicates scope, it must describe the same immutable intent.
  for (const scope of ['organizationId', 'branchId'] as const) {
    if (Object.prototype.hasOwnProperty.call(value.payload, scope) && value.payload[scope] !== value[scope]) return false;
  }
  for (const timing of ['lastAttemptAt', 'nextAttemptAt'] as const) {
    if (value[timing] !== undefined && parseOutboxTimestamp(value[timing]) === null) return false;
  }
  if (value.status === 'SYNCING' && parseOutboxTimestamp(value.lastAttemptAt) === null) return false;
  for (const field of ['lastErrorCode', 'serverId'] as const) {
    if (value[field] !== undefined && !nonblankString(value[field])) return false;
  }
  return true;
}

export function resetInterruptedReplay(operation: OutboxOperation): OutboxOperation {
  if (!isRecoverableLegacyOperation(operation) || operation.status !== 'SYNCING') {
    // A malformed interrupted record stays durable and fail-closed, including
    // through owner switches. Never infer a timestamp or new replay identity.
    return operation;
  }
  return { ...operation, status: 'PENDING', nextAttemptAt: undefined, lastErrorCode: undefined };
}

// Envelope validity and immutable-key grouping are deliberately separate.
export type OutboxRecoveryClassification =
  | 'UNIQUE' | 'IDENTICAL_RETRIES' | 'IMMUTABLE_CONFLICT' | 'MALFORMED_ENVELOPE' | 'QUARANTINED_KEY';

export type OutboxRecoveryGroup = {
  classification: OutboxRecoveryClassification;
  records: unknown[];
  operation?: OutboxOperation;
};

export type OutboxQuarantinedRecord = {
  record: unknown;
  reason: OutboxRecoveryClassification;
};

export function storedOutboxIdempotencyKey(value: unknown): string | undefined {
  return record(value) && typeof value.idempotencyKey === 'string' ? value.idempotencyKey : undefined;
}

export function stableOutboxSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableOutboxSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableOutboxSerialize(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function immutableOutboxContentMatches(left: OutboxOperation, right: OutboxOperation): boolean {
  const content = (operation: OutboxOperation) => ({
    kind: operation.kind,
    organizationId: operation.organizationId,
    branchId: operation.branchId ?? null,
    payload: operation.payload,
  });
  return stableOutboxSerialize(content(left)) === stableOutboxSerialize(content(right));
}

export function sortRecoverableOutboxOperations(operations: readonly OutboxOperation[]): OutboxOperation[] {
  return [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

// Never sort unvalidated fields; retain invalid siblings for key grouping.
export function orderOutboxRecoveryRecords(values: readonly unknown[]): unknown[] {
  return [
    ...sortRecoverableOutboxOperations(values.filter(isRecoverableLegacyOperation)),
    ...values.filter((value) => !isRecoverableLegacyOperation(value)),
  ];
}

export function classifyOutboxRecoveryGroups(
  values: readonly unknown[],
  blockedKeys: ReadonlySet<string> = new Set(),
): {
  groups: Map<string, OutboxRecoveryGroup>;
  operations: OutboxOperation[];
  rejected: OutboxQuarantinedRecord[];
  complete: boolean;
} {
  const groups = new Map<string, OutboxRecoveryGroup>();
  const rejected: OutboxQuarantinedRecord[] = [];
  for (const value of values) {
    const key = storedOutboxIdempotencyKey(value);
    if (key === undefined) {
      rejected.push({ record: value, reason: 'MALFORMED_ENVELOPE' });
      continue;
    }
    const group = groups.get(key) ?? { classification: 'UNIQUE', records: [] };
    group.records.push(value);
    groups.set(key, group);
  }
  const operations: OutboxOperation[] = [];
  for (const [key, group] of groups) {
    if (!group.records.every(isRecoverableLegacyOperation)) {
      group.classification = 'MALFORMED_ENVELOPE';
    } else if (blockedKeys.has(key)) {
      group.classification = 'QUARANTINED_KEY';
    } else {
      const first = group.records[0] as OutboxOperation;
      if (group.records.some((candidate) => !immutableOutboxContentMatches(first, candidate as OutboxOperation))) {
        group.classification = 'IMMUTABLE_CONFLICT';
      } else {
        group.classification = group.records.length > 1 ? 'IDENTICAL_RETRIES' : 'UNIQUE';
        // Destination precedes incoming recovery to preserve its lifecycle.
        group.operation = first;
        operations.push(first);
      }
    }
    if (!group.operation) {
      rejected.push(...group.records.map((value) => ({ record: value, reason: group.classification })));
    }
  }
  return { groups, operations: sortRecoverableOutboxOperations(operations), rejected, complete: rejected.length === 0 };
}

// Preserve every parsed member until source/destination grouping is complete.
export function parseOutboxRecoverySource(raw: string, version?: 1): { records: unknown[]; validContainer: boolean } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed) || (version !== undefined && parsed.version !== version)
      || !Array.isArray(parsed.operations)) return { records: [], validContainer: false };
    return { records: parsed.operations, validContainer: true };
  } catch {
    return { records: [], validContainer: false };
  }
}

export function classifyOutboxRecoverySource(
  source: readonly unknown[],
  destination: readonly unknown[],
  blockedKeys: ReadonlySet<string> = new Set(),
): { operations: OutboxOperation[]; disputed: OutboxQuarantinedRecord[]; complete: boolean } {
  const incoming = classifyOutboxRecoveryGroups(orderOutboxRecoveryRecords(source), blockedKeys);
  const joint = classifyOutboxRecoveryGroups([
    ...orderOutboxRecoveryRecords(destination), ...orderOutboxRecoveryRecords(source),
  ], blockedKeys);
  const operations = incoming.operations.filter((item) => joint.groups.get(item.idempotencyKey)?.operation);
  const destinationMembers = new Set(destination);
  // A rejected source key must carry its original members into destination
  // classification. Quarantine only affected keys that have destination state;
  // source-only rejections remain durable at their existing recovery source.
  const disputedKeys = new Set([...new Set([...incoming.groups.keys(), ...blockedKeys])].filter((key) => {
    const group = joint.groups.get(key);
    return group && !group.operation && group.records.some((item) => destinationMembers.has(item));
  }));
  return {
    operations,
    disputed: joint.rejected.filter(({ record: value }) => {
      const key = storedOutboxIdempotencyKey(value);
      return key !== undefined && disputedKeys.has(key);
    }),
    // No destination is required for legitimate cleanup after sync/removal.
    complete: incoming.complete && operations.length === incoming.operations.length,
  };
}

export function quarantinedOutboxKeys(value: unknown, ownerId?: string | null): Set<string> {
  return quarantineOutboxEvidence(value, ownerId).blockedKeys;
}

// Quarantine equality preserves stored field presence and values. Immutable
// intent serialization intentionally ignores undefined; raw retention must not.
function quarantinedRecordsMatch(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && Object.is(left.getTime(), right.getTime());
  }
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const prototype = Object.getPrototypeOf(left);
  if (prototype !== Object.getPrototypeOf(right)
    || (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)) return false;
  const previous = seen.get(left);
  if (previous) return previous === right;
  seen.set(left, right);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key)
    && quarantinedRecordsMatch((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], seen));
}

export function retainOutboxQuarantine(existing: readonly OutboxQuarantinedRecord[], incoming: readonly OutboxQuarantinedRecord[]): OutboxQuarantinedRecord[];
export function retainOutboxQuarantine(existing: unknown, incoming: readonly unknown[]): unknown[];
export function retainOutboxQuarantine(existing: unknown, incoming: readonly unknown[]): unknown[] {
  const retained: unknown[] = Array.isArray(existing) ? [...existing] : existing === undefined ? [] : [existing];
  const contents = (item: unknown) => record(item) && 'record' in item ? item.record : item;
  for (const item of incoming) {
    if (!retained.some((prior) => quarantinedRecordsMatch(contents(prior), contents(item)))) retained.push(item);
  }
  return retained;
}

// Limits bound inspection of corrupted wrapper chains/collections. Exhaustion
// is uncertainty, not proof that the remaining owner-scoped evidence is garbage.
export const OUTBOX_EVIDENCE_MAX_DEPTH = 64;
export const OUTBOX_EVIDENCE_MAX_NODES = 4096;

export type OutboxInspectionUncertainty = {
  ownerId?: string | null;
  idempotencyKey?: string;
  reason: 'DEPTH_LIMIT' | 'NODE_LIMIT';
};

export type OutboxEvidenceSource = 'WRAPPER' | 'RECEIPT' | 'ARCHIVE' | 'DESTINATION' | 'QUARANTINE';
const EVIDENCE_FIELDS = ['record', 'records', 'operations', 'raw', 'sourceFingerprint', 'quarantine'] as const;
function explicitOutboxOwner(value: unknown): { ownerId: string | null } | undefined {
  return record(value) && (value.ownerId === null || nonblankString(value.ownerId)) ? { ownerId: value.ownerId } : undefined;
}
export type OutboxOwnershipConflict = { expectedOwnerId: string | null; explicitOwnerId?: string | null; idempotencyKey?: string };
type EvidenceScope = { ownerId?: string | null; idempotencyKey?: string; boundKey?: string; attributed: boolean;
  explicitOwnerId?: string | null; namespaceOwnerId?: string | null; namespaceKey?: string; proofOwnerId?: string | null; proofKey?: string; ownershipConflict?: boolean;
  source: OutboxEvidenceSource; disposition: 'QUARANTINE' | 'REJECTED_ROW' | 'WITNESS' };
function evidenceScope(value: unknown, inherited: EvidenceScope): EvidenceScope {
  const scope: EvidenceScope = { ...inherited, explicitOwnerId: undefined, namespaceOwnerId: undefined, namespaceKey: undefined };
  if (!record(value)) return scope;
  if (value.ownerId === null || nonblankString(value.ownerId)) {
    if (scope.ownerId !== value.ownerId) { scope.idempotencyKey = undefined; scope.boundKey = undefined; }
    scope.ownerId = value.ownerId; scope.explicitOwnerId = value.ownerId; scope.attributed = true;
  }
  if (scope.source === 'RECEIPT' && scope.proofOwnerId !== undefined && 'ownerId' in value
    && (scope.explicitOwnerId === undefined || scope.explicitOwnerId !== scope.proofOwnerId)) scope.ownershipConflict = true;
  const key = storedOutboxIdempotencyKey(value);
  if (key !== undefined) {
    scope.idempotencyKey = key;
    if (scope.boundKey !== undefined && isRecoverableLegacyOperation(value as unknown)) scope.boundKey = key;
  }
  if (typeof value.key === 'string') {
    const prefix = [LEGACY_USER_IMPORT_PREFIX, 'key-value-outbox-v2:import:'].find(prefix => (value.key as string).startsWith(prefix));
    if (prefix) try {
      const namespace: unknown = JSON.parse(value.key.slice(prefix.length));
      if (Array.isArray(namespace) && namespace.length === 2 && (namespace[0] === null || nonblankString(namespace[0])) && typeof namespace[1] === 'string') {
        scope.namespaceOwnerId = namespace[0]; scope.namespaceKey = namespace[1];
        // A receipt namespace is a proof binding, not permission to replace a
        // contradictory explicit owner for routing its unowned children.
        if (scope.explicitOwnerId === undefined) scope.ownerId = namespace[0];
        scope.idempotencyKey = namespace[1]; scope.boundKey = namespace[1]; scope.attributed = true;
      }
    } catch { /* No identity is invented from an invalid namespace. */ }
    else if (value.key.startsWith('legacy-local-storage-v1:import:')) {
      scope.idempotencyKey = value.key.slice('legacy-local-storage-v1:import:'.length); scope.boundKey = scope.idempotencyKey;
    }
  }
  return scope;
}
function relevantUncertainty(item: OutboxInspectionUncertainty, ownerId?: string | null) {
  return ownerId === undefined || item.ownerId === undefined || item.ownerId === ownerId;
}
function inspectionMetadata(uncertainties: readonly OutboxInspectionUncertainty[], ownerId?: string | null) {
  return { ...(uncertainties.length ? { uncertainties: [...uncertainties] } : {}),
    ...(uncertainties.some(item => relevantUncertainty(item, ownerId) && item.idempotencyKey === undefined) ? { incomplete: true } : {}) };
}

// Shallow collection routing examines stored owner/key headers before assigning
// a deep-walk budget. Foreign headers never consume the selected owner's budget.
// Unvisited children retain scope as uncertainty; they are never empty evidence.
export function inspectOutboxEvidence(value: unknown, ownerId?: string | null, requireExplicitOwner = false, idempotencyKey?: string, source: OutboxEvidenceSource = idempotencyKey === undefined ? 'WRAPPER' : 'RECEIPT', inheritedOwnerId?: string | null) {
  const records: unknown[] = [];
  const markerKeys = new Set<string>();
  const quarantineKeys = new Set<string>();
  const uncertainties: OutboxInspectionUncertainty[] = [];
  const ownershipConflicts: OutboxOwnershipConflict[] = [];
  const ownershipKeys = new Set<string>();
  const ownershipContexts = new Set<string>();
  let foreignInspected = 0;
  const pending = [{ value, depth: 0, scope: { ownerId: requireExplicitOwner ? undefined : inheritedOwnerId === undefined ? ownerId : inheritedOwnerId, idempotencyKey, boundKey: idempotencyKey, attributed: !requireExplicitOwner, source, ...(source === 'RECEIPT' ? { proofOwnerId: ownerId, proofKey: idempotencyKey, ownershipConflict: inheritedOwnerId !== undefined && ownerId !== undefined && inheritedOwnerId !== ownerId } : {}), disposition: source === 'QUARANTINE' ? 'QUARANTINE' : 'WITNESS' } as EvidenceScope }];
  const seen = new Map<unknown, Set<string>>();
  const uncertaintyScopes = new Set<string>();
  let inspected = 0;
  const uncertain = (scope: EvidenceScope, reason: OutboxInspectionUncertainty['reason'], value: unknown) => {
    // A malformed keyed parent can hold children of different keys. Only a
    // stored receipt namespace binds unknown descendants to one intent; a leaf
    // with no recognizable children can still supply its own stored key.
    const unknownChildren = record(value) && ['record', 'records', 'operations', 'raw', 'sourceFingerprint', 'quarantine', 'vaults']
      .some(field => Object.prototype.hasOwnProperty.call(value, field));
    const key = unknownChildren && scope.boundKey === undefined ? undefined : scope.idempotencyKey;
    const proofBound = scope.ownershipConflict && scope.proofKey !== undefined;
    const narrowOwner = proofBound ? scope.proofOwnerId : scope.ownerId;
    const narrowKey = proofBound ? scope.proofKey : key;
    const item = { ...(narrowOwner !== undefined ? { ownerId: narrowOwner } : {}),
      ...(narrowKey !== undefined ? { idempotencyKey: narrowKey } : {}), reason };
    const encoded = JSON.stringify(item);
    if (!uncertaintyScopes.has(encoded)) { uncertaintyScopes.add(encoded); uncertainties.push(item); }
  };
  while (pending.length) {
    const item = pending.pop()!;
    const current = record(item.value) ? item.value : undefined;
    const scope = evidenceScope(item.value, item.scope);
    if (scope.ownershipConflict && scope.proofOwnerId !== undefined) {
      const key = scope.proofKey ?? storedOutboxIdempotencyKey(item.value) ?? scope.idempotencyKey;
      if (key !== undefined) ownershipKeys.add(key);
      const conflict = { expectedOwnerId: scope.proofOwnerId, ...(scope.explicitOwnerId !== undefined ? { explicitOwnerId: scope.explicitOwnerId } : {}),
        ...(key !== undefined ? { idempotencyKey: key } : {}) };
      const encoded = JSON.stringify(conflict);
      if (!ownershipContexts.has(encoded)) { ownershipContexts.add(encoded); ownershipConflicts.push(conflict); }
    }
    if (scope.namespaceOwnerId !== undefined && scope.explicitOwnerId !== undefined
      && scope.namespaceOwnerId !== scope.explicitOwnerId && scope.namespaceKey !== undefined
      && (ownerId === undefined || scope.namespaceOwnerId === ownerId)) markerKeys.add(scope.namespaceKey);
    const context = JSON.stringify(scope);
    const contexts = seen.get(item.value) ?? new Set<string>();
    if (contexts.has(context)) continue;
    contexts.add(context); seen.set(item.value, contexts);
    const child = (value: unknown, childScope: EvidenceScope = { ...scope, idempotencyKey: scope.boundKey,
      disposition: scope.disposition === 'REJECTED_ROW' ? 'WITNESS' : scope.disposition }) => pending.push({ value, depth: item.depth + 1, scope: childScope });
    const retainedRecordKey = current ? storedOutboxIdempotencyKey(current.record) : undefined;
    const retainedRecordOwner = current ? explicitOutboxOwner(current.record) : undefined;
    const rejectedRecord = current && scope.source === 'QUARANTINE'
      && (current.reason === 'MALFORMED_ENVELOPE' || current.reason === 'QUARANTINED_KEY')
      && retainedRecordKey !== undefined && (!isRecoverableLegacyOperation(current.record)
        || (retainedRecordOwner !== undefined && scope.ownerId !== undefined && retainedRecordOwner.ownerId !== scope.ownerId));
    if (current && scope.source === 'QUARANTINE' && retainedRecordKey !== undefined && isOutboxQuarantineRecord(current as unknown)
      && scope.attributed && (ownerId === undefined || scope.ownerId === ownerId)) quarantineKeys.add(retainedRecordKey);
    // A physical vault slot supplies inherited owner context; foreign slots
    // can still contain independently explicit selected-owner descendants.
    if (current && ownerId !== undefined && record(current.vaults)) {
      for (const [storedOwner, value] of Object.entries(current.vaults)) {
        const vaultOwner = nonblankString(storedOwner) ? storedOwner : undefined;
        const boundKey = vaultOwner === scope.ownerId ? scope.boundKey : undefined;
        child(value, { ...scope, ownerId: vaultOwner, attributed: vaultOwner !== undefined,
          idempotencyKey: boundKey, boundKey });
      }
    }
    const scopedQuarantine = current && ownerId !== undefined && ('vaults' in current || current.version === 2
      || ('version' in current && current.version !== 1 && 'operations' in current));
    if (scopedQuarantine && 'quarantine' in current!) child(current!.quarantine, { attributed: false, source: 'QUARANTINE', disposition: 'QUARANTINE' });
    if (ownerId !== undefined && scope.ownerId !== undefined && scope.ownerId !== ownerId) {
      // Foreign ownership controls unowned descendants, not independently owned
      // recognized children. Route without emitting/adopting foreign records.
      let candidates: { value: unknown; field?: typeof EVIDENCE_FIELDS[number] }[] = [];
      if (Array.isArray(item.value)) candidates = item.value.map(value => ({ value }));
      else if (typeof item.value === 'string') {
        try { candidates = [{ value: JSON.parse(item.value) }]; } catch { /* Fully inspected foreign garbage has no child owner. */ }
      } else if (current) candidates = EVIDENCE_FIELDS.filter(field => !(field === 'quarantine' && scopedQuarantine))
        .filter(field => Object.prototype.hasOwnProperty.call(current, field)).map(field => ({ value: current[field], field }));
      const routable = candidates.filter(({ value }) => record(value) || Array.isArray(value) || (typeof value === 'string' && /^[\s]*[\[{"]/.test(value)));
      if (!routable.length) continue;
      const reason = item.depth > OUTBOX_EVIDENCE_MAX_DEPTH ? 'DEPTH_LIMIT' : foreignInspected >= OUTBOX_EVIDENCE_MAX_NODES ? 'NODE_LIMIT' : undefined;
      if (!reason) foreignInspected++;
      for (const { value, field } of routable) {
        const next = evidenceScope(value, { ...scope, idempotencyKey: scope.boundKey });
        if (!reason || next.ownerId === ownerId) {
          if (field === 'record' && rejectedRecord) child(value, { ...scope, disposition: 'REJECTED_ROW' });
          else child(value);
        }
        else {
          // Preserve the known inherited owner until an explicit child override
          // is observed. Foreign exhaustion cannot invent a current-owner scope.
          uncertain(next, reason, value);
        }
      }
      continue;
    }
    if (Array.isArray(item.value)) {
      const exhausted = item.depth > OUTBOX_EVIDENCE_MAX_DEPTH ? 'DEPTH_LIMIT'
        : inspected >= OUTBOX_EVIDENCE_MAX_NODES ? 'NODE_LIMIT' : undefined;
      if (!exhausted) inspected++;
      let available = exhausted ? 0 : Math.max(0, OUTBOX_EVIDENCE_MAX_NODES - inspected - pending.length);
      const routed: typeof pending = [];
      for (let index = 0; index < item.value.length; index++) {
        const value = item.value[index];
        const selected = evidenceScope(value, { ...scope, idempotencyKey: scope.boundKey });
        if (ownerId !== undefined && selected.ownerId !== undefined && selected.ownerId !== ownerId) {
          // Foreign active wrappers may independently hold our named vault or
          // explicitly scoped quarantine. Route those headers even when the
          // deep-walk budget is spent; the parent itself spends no owner budget.
          if (record(value) || Array.isArray(value) || (typeof value === 'string' && /^[\s]*[\[{"]/.test(value))) routed.push({ value, depth: item.depth + 1, scope: selected });
          continue;
        }
        if (available > 0) { routed.push({ value, depth: item.depth + 1, scope: selected }); available--; }
        else uncertain(selected, exhausted ?? 'NODE_LIMIT', value);
      }
      pending.push(...routed.reverse());
      continue;
    }
    if (item.depth > OUTBOX_EVIDENCE_MAX_DEPTH) { uncertain(scope, 'DEPTH_LIMIT', item.value); continue; }
    if (inspected >= OUTBOX_EVIDENCE_MAX_NODES) { uncertain(scope, 'NODE_LIMIT', item.value); continue; }
    inspected++;
    if (typeof item.value === 'string') {
      try { child(JSON.parse(item.value)); } catch { /* Raw garbage stays retained, without identity. */ }
      continue;
    }
    if (!current) continue;
    if (scope.attributed && typeof current.key === 'string' && scope.idempotencyKey !== undefined
      && (ownerId === undefined || scope.namespaceOwnerId === undefined || scope.namespaceOwnerId === ownerId)) markerKeys.add(scope.idempotencyKey);
    const currentKey = storedOutboxIdempotencyKey(current);
    if (scope.attributed && currentKey !== undefined) {
      records.push(current);
      if (scope.disposition !== 'WITNESS' || !isRecoverableLegacyOperation(current as unknown)) quarantineKeys.add(currentKey);
    }
    for (const field of EVIDENCE_FIELDS) {
      if (field === 'quarantine' && scopedQuarantine) continue;
      if (Object.prototype.hasOwnProperty.call(current, field)) {
        // A retained malformed row rejects its own immediate key. Its valid
        // descendants remain independent immutable witnesses; they are not
        // implicitly rejected merely for sharing the rejected row's container.
        if (field === 'record' && rejectedRecord) child(current[field], { ...scope, disposition: 'REJECTED_ROW' });
        else child(current[field]);
      }
    }
  }
  const metadata = inspectionMetadata(uncertainties, ownerId);
  for (const item of uncertainties) if (relevantUncertainty(item, ownerId) && item.idempotencyKey !== undefined) markerKeys.add(item.idempotencyKey);
  return { raw: value, records, markerKeys, quarantineKeys, ownershipConflicts, ownershipKeys, ...metadata };
}

export function quarantineOutboxEvidence(value: unknown, ownerId?: string | null, requireExplicitOwner = false, inheritedOwnerId?: string | null): OutboxEvidence {
  const extracted = inspectOutboxEvidence(value, ownerId, requireExplicitOwner, undefined, 'QUARANTINE', inheritedOwnerId);
  const blockedKeys = new Set([...extracted.markerKeys, ...extracted.quarantineKeys]);
  return { records: extracted.records, blockedKeys, ...inspectionMetadata(extracted.uncertainties ?? [], ownerId) };
}

// A foreign ordinary source supplies immutable witnesses for explicit current-
// owner descendants, never activation or completion proof for this owner.
export function outboxWitnessEvidence(value: unknown, ownerId: string | null, requireExplicitOwner = true, inheritedOwnerId?: string | null): OutboxEvidence {
  const extracted = inspectOutboxEvidence(value, ownerId, requireExplicitOwner, undefined, 'WRAPPER', inheritedOwnerId);
  return { records: extracted.records, blockedKeys: new Set([...extracted.markerKeys, ...extracted.quarantineKeys]),
    ...inspectionMetadata(extracted.uncertainties ?? [], ownerId) };
}

// Persisted rows are admission candidates only in their original slots. Nested
// fragments are evidence, never additional operations to activate/import.
export function outboxOperationEvidence(rows: readonly unknown[], ownerId: string | null, source: 'ARCHIVE' | 'DESTINATION' = 'DESTINATION'): OutboxEvidence {
  const evidence: OutboxEvidence[] = [];
  for (const row of rows) {
    const extracted = inspectOutboxEvidence(row, ownerId, false, undefined, source);
    const blockedKeys = new Set([...extracted.markerKeys, ...extracted.quarantineKeys]);
    const explicit = explicitOutboxOwner(row);
    const key = storedOutboxIdempotencyKey(row);
    // Admission in an owned slot/source cannot borrow a contradictory row owner.
    if (explicit && explicit.ownerId !== ownerId && key !== undefined) blockedKeys.add(key);
    evidence.push({ records: extracted.records.filter(item => item !== row),
      blockedKeys,
      ...inspectionMetadata(extracted.uncertainties ?? [], ownerId) });
  }
  return mergeOutboxEvidence(...evidence);
}

export function scopedOutboxQuarantineEvidence(value: unknown, ownerId: string | null): OutboxEvidence {
  return quarantineOutboxEvidence(value, ownerId, true);
}

function isOutboxQuarantineRecord(value: unknown): value is OutboxQuarantinedRecord {
  return record(value) && Object.prototype.hasOwnProperty.call(value, 'record') && typeof value.reason === 'string'
    && ['UNIQUE', 'IDENTICAL_RETRIES', 'IMMUTABLE_CONFLICT', 'MALFORMED_ENVELOPE', 'QUARANTINED_KEY'].includes(value.reason);
}

// Keep original malformed scoped values intact. Add/reuse a supported entry only
// when actual destination rows need quarantine; garbage alone causes no rewrite.
export function retainScopedOutboxQuarantine(value: unknown, ownerId: string | null, incoming: readonly OutboxQuarantinedRecord[]): unknown {
  if (!incoming.length) return value;
  const entries: unknown[] = Array.isArray(value) ? [...value] : value === undefined ? [] : [value];
  const index = entries.findIndex((item) => record(item) && item.ownerId === ownerId && Array.isArray(item.records));
  const prior = index >= 0 ? entries[index] as Record<string, unknown> : undefined;
  const entry = { ...prior, ownerId, records: retainOutboxQuarantine(prior?.records, incoming) };
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  return entries;
}

// If inspection is exhausted, fail closed for the current scope's actual keys.
// Unidentifiable inspected garbage does not set incomplete and blocks nothing.
export function outboxEvidenceBlockedKeys(evidence: OutboxEvidence, current: readonly unknown[]): Set<string> {
  const blocked = new Set(evidence.blockedKeys);
  if (evidence.incomplete) for (const item of current) {
    const key = storedOutboxIdempotencyKey(item);
    if (key !== undefined) blocked.add(key);
  }
  return blocked;
}

// Receipts are historical intent evidence, even after destination removal.
// Callers retain the original value; this view never repairs or invents identity.
export type OutboxReceiptEvidence = {
  records: unknown[];
  blockedKeys: Set<string>;
  valid: boolean;
  ownerId?: string | null;
  importedIds: Map<string, string>;
  incomplete?: boolean;
  uncertainties?: OutboxInspectionUncertainty[];
};

export function classifyOutboxReceiptEvidence(
  value: unknown,
  marker?: { key: string; idempotencyKey?: string; ownerId?: string | null },
  snapshot: { version?: 1 } = { version: 1 },
): OutboxReceiptEvidence {
  const records: unknown[] = [];
  let ownerId: string | null | undefined;
  let structural = false;
  let fingerprintContainerValid = false;
  const taintedKeys = new Set<string>();
  let incomplete = false;
  const uncertainties: OutboxInspectionUncertainty[] = [];
  let ownershipConflict = false;
  let proofOwnerId: string | null | undefined = marker?.ownerId;
  if (proofOwnerId === undefined && marker) {
    const namespace = evidenceScope({ key: marker.key }, { attributed: false, source: 'RECEIPT', disposition: 'WITNESS' });
    proofOwnerId = namespace.ownerId;
  }
  if (record(value)) {
    if (value.ownerId === null || nonblankString(value.ownerId)) ownerId = value.ownerId;
    if (proofOwnerId === undefined) proofOwnerId = ownerId;
    const raw = marker ? value.sourceFingerprint : value.raw;
    if (raw !== undefined) {
      try {
        const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const inheritedOwner = ownerId === undefined ? proofOwnerId : ownerId;
        const parsedOwnerInfo = explicitOutboxOwner(parsed);
        const parsedOwner = parsedOwnerInfo ? parsedOwnerInfo.ownerId : inheritedOwner;
        const append = (items: unknown[], inheritedOwner = ownerId === undefined ? proofOwnerId : ownerId) => {
          for (const item of items) {
            const explicit = explicitOutboxOwner(item);
            const effective = explicit ? explicit.ownerId : inheritedOwner;
            if (proofOwnerId === undefined || effective === undefined || effective === proofOwnerId) records.push(item);
          }
        };
        if (marker) {
          fingerprintContainerValid = record(parsed) && storedOutboxIdempotencyKey(parsed) !== undefined;
          append(Array.isArray(parsed) ? parsed : [parsed], parsedOwner);
        } else if (Array.isArray(parsed)) append(parsed);
        else if (record(parsed) && 'operations' in parsed) append(Array.isArray(parsed.operations) ? parsed.operations : [parsed.operations], parsedOwner);
        else if (storedOutboxIdempotencyKey(parsed) !== undefined) append([parsed], parsedOwner);
        // Nested fragments remain tainted evidence; original malformed members
        // also remain present so a missing key cannot validate a receipt.
        const extracted = inspectOutboxEvidence(parsed, proofOwnerId, false, marker?.idempotencyKey, 'RECEIPT', inheritedOwner);
        incomplete ||= extracted.incomplete === true;
        ownershipConflict ||= extracted.ownershipConflicts.length > 0;
        for (const key of extracted.ownershipKeys) taintedKeys.add(key);
        uncertainties.push(...extracted.uncertainties ?? []);
        for (const key of extracted.markerKeys) taintedKeys.add(key);
        for (const fragment of extracted.records) if (!records.includes(fragment)) {
          records.push(fragment);
          const key = storedOutboxIdempotencyKey(fragment);
          const independent = ownershipConflict && marker?.idempotencyKey !== undefined && key !== marker.idempotencyKey
            && explicitOutboxOwner(fragment)?.ownerId === proofOwnerId && isRecoverableLegacyOperation(fragment);
          if (key !== undefined && !independent) taintedKeys.add(key);
        }
      } catch { /* Unidentifiable raw garbage stays at its receipt source. */ }
    }
    structural = marker
      ? fingerprintContainerValid && marker.idempotencyKey !== undefined && value.key === marker.key && typeof value.sourceFingerprint === 'string' && nonblankString(value.importedId)
        && (!('ownerId' in value) || (ownerId !== undefined && (marker.ownerId === undefined || ownerId === marker.ownerId)))
        && records.length === 1 && storedOutboxIdempotencyKey(records[0]) === marker.idempotencyKey
      : ownerId !== undefined && typeof value.raw === 'string'
        && parseOutboxRecoverySource(value.raw, snapshot.version).validContainer;
  }
  const extra = record(value) ? { ...explicitOutboxOwner(value), record: value.record, records: value.records, operations: value.operations,
    ...(storedOutboxIdempotencyKey(value) !== undefined ? { record: value } : {}) } : value;
  const extraEvidence = inspectOutboxEvidence(extra, proofOwnerId, false, marker?.idempotencyKey, 'RECEIPT', ownerId);
  incomplete ||= extraEvidence.incomplete === true;
  ownershipConflict ||= extraEvidence.ownershipConflicts.length > 0;
  for (const key of extraEvidence.ownershipKeys) taintedKeys.add(key);
  uncertainties.push(...extraEvidence.uncertainties ?? []);
  for (const key of extraEvidence.markerKeys) taintedKeys.add(key);
  for (const fragment of extraEvidence.records) if (!records.includes(fragment)) {
    records.push(fragment);
    const key = storedOutboxIdempotencyKey(fragment);
    const independent = ownershipConflict && marker?.idempotencyKey !== undefined && key !== marker.idempotencyKey
      && explicitOutboxOwner(fragment)?.ownerId === proofOwnerId && isRecoverableLegacyOperation(fragment);
    if (key !== undefined && !independent) taintedKeys.add(key);
  }
  const classified = classifyOutboxRecoveryGroups(records, taintedKeys);
  const valid = !ownershipConflict && !incomplete && !uncertainties.some(item => relevantUncertainty(item, proofOwnerId)) && structural && classified.complete;
  const blockedKeys = new Set(taintedKeys);
  for (const [key, group] of classified.groups) if (!group.operation || (!structural && !(ownershipConflict && marker?.idempotencyKey !== undefined))) blockedKeys.add(key);
  // The metadata key supplies identity independently of a broken fingerprint.
  if (marker?.idempotencyKey !== undefined && !valid) blockedKeys.add(marker.idempotencyKey);
  const importedIds = new Map<string, string>();
  if (valid) for (const operation of classified.operations) importedIds.set(operation.idempotencyKey,
    marker && record(value) ? value.importedId as string : operation.id);
  return { records, blockedKeys, valid, ownerId, importedIds, ...inspectionMetadata(uncertainties, proofOwnerId), ...(incomplete ? { incomplete: true } : {}) };
}

export const LEGACY_OUTBOX_KEY = 'pharmacystock:outbox:v1:operations';
export const LEGACY_OUTBOX_OWNER_KEY = 'pharmacystock:offline-scope:v1:user-id';
export const LEGACY_USER_IMPORT_PREFIX = 'legacy-session-vault-v1:import:';
export function legacyOutboxVaultKey(ownerId: string): string {
  return `pharmacystock:offline-scope:v1:vault:${ownerId}`;
}

export type OutboxEvidence = { records: unknown[]; blockedKeys: Set<string>; importedIds?: ReadonlyMap<string, string>; incomplete?: boolean; uncertainties?: OutboxInspectionUncertainty[] };
export function mergeOutboxEvidence(...sources: OutboxEvidence[]): OutboxEvidence {
  return { records: sources.flatMap((source) => source.records),
    blockedKeys: new Set(sources.flatMap((source) => [...source.blockedKeys])),
    importedIds: new Map(sources.flatMap((source) => [...(source.importedIds ?? [])])),
    ...(sources.some((source) => source.incomplete) ? { incomplete: true } : {}),
    ...(sources.some(source => source.uncertainties?.length) ? { uncertainties: sources.flatMap(source => source.uncertainties ?? []) } : {}) };
}

// Read current raw sources at each authority boundary; never require import to
// have run. Unknown global ownership supplies evidence, never activation proof.
export function visibleLegacyOutboxEvidence(storage: KeyValueStorage, ownerId: string | null): OutboxEvidence {
  const sources: OutboxEvidence[] = [];
  const globalOwner = storage.getItem(LEGACY_OUTBOX_OWNER_KEY);
  const global = storage.getItem(LEGACY_OUTBOX_KEY);
  if (global !== null && (globalOwner === ownerId || globalOwner === null)) {
    const evidence = classifyOutboxReceiptEvidence({ raw: global, ownerId: globalOwner });
    sources.push({ ...evidence, importedIds: undefined });
  } else if (global !== null) {
    const wrapper = { ownerId: globalOwner, raw: global };
    sources.push(parseOutboxRecoverySource(global, 1).validContainer
      ? outboxWitnessEvidence(wrapper, ownerId) : scopedOutboxQuarantineEvidence(wrapper, ownerId));
  }
  if (ownerId !== null) {
    const raw = storage.getItem(legacyOutboxVaultKey(ownerId));
    if (raw !== null) {
      const evidence = classifyOutboxReceiptEvidence({ raw, ownerId }, undefined, {});
      sources.push({ ...evidence, importedIds: undefined });
    }
  }
  return mergeOutboxEvidence(...sources);
}

export function isOutboxReceiptMap(value: unknown): value is Record<string, unknown> {
  return record(value) && !['key', 'sourceFingerprint', 'raw', 'idempotencyKey', 'ownerId', 'record', 'records', 'operations']
    .some((field) => field in value);
}

// Native per-user markers use the same owner/key namespace and canonical
// fingerprint representation as IndexedDB; the containing v2 write is atomic.
export function scopedOutboxReceiptEvidence(value: unknown, ownerId: string | null): OutboxEvidence {
  if (typeof value === 'string') {
    try {
      const evidence = scopedOutboxReceiptEvidence(JSON.parse(value), ownerId);
      for (const item of evidence.records) { const key = storedOutboxIdempotencyKey(item); if (key !== undefined) evidence.blockedKeys.add(key); }
      return { ...evidence, importedIds: new Map() };
    }
    catch { return { records: [], blockedKeys: new Set() }; }
  }
  const sources: OutboxEvidence[] = [];
  const entries: [string | undefined, unknown][] = Array.isArray(value)
    ? value.map(item => [undefined, item]) : record(value) ? Object.entries(value) : [];
  // Interpret each discoverable map child independently. An unrelated malformed
  // sibling never downgrades a structurally valid owner/key receipt child.
  for (const [encoded, marker] of entries) {
    const childKey = record(marker) && typeof marker.key === 'string' ? marker.key : undefined;
    let namespace: unknown;
    try { namespace = JSON.parse(encoded ?? ''); } catch { /* Not a stored map namespace. */ }
    const mapChild = Array.isArray(namespace) && namespace.length === 2
      && (namespace[0] === null || nonblankString(namespace[0])) && typeof namespace[1] === 'string';
    const markerKey = mapChild ? `${LEGACY_USER_IMPORT_PREFIX}${encoded}` : childKey;
    if (markerKey === undefined) {
      // A malformed foreign/unattributed marker is not import proof. Its
      // recognized descendants can still explicitly identify another owner.
      sources.push(scopedOutboxQuarantineEvidence(marker, ownerId));
      continue;
    }
    let key: string | undefined;
    let attributed = record(marker) && marker.ownerId === ownerId;
    try {
      const scope: unknown = JSON.parse(markerKey.slice(LEGACY_USER_IMPORT_PREFIX.length));
      if (markerKey.startsWith(LEGACY_USER_IMPORT_PREFIX) && Array.isArray(scope) && scope.length === 2
        && (scope[0] === null || nonblankString(scope[0]))) {
        if (scope[0] !== ownerId) { sources.push(quarantineOutboxEvidence(marker, ownerId, false, scope[0])); continue; }
        attributed = true;
        if (typeof scope[1] === 'string') key = scope[1];
      }
    } catch { /* No identity is invented for an unknown namespace. */ }
    if (!attributed) {
      sources.push(scopedOutboxQuarantineEvidence(marker, ownerId));
      continue;
    }
    sources.push(classifyOutboxReceiptEvidence(marker, { key: markerKey, idempotencyKey: key, ownerId }));
  }
  // The same root may also be a malformed receipt wrapper. Inspect its recognized
  // fields without walking arbitrary properties or discarding extracted metadata.
  if (record(value) && !isOutboxReceiptMap(value)) {
    const scoped = scopedOutboxQuarantineEvidence(value, ownerId);
    sources.push(scoped);
  }
  return mergeOutboxEvidence(...sources);
}

// Original unsupported roots remain durable. Valid identifiable receipt children
// still provide history; malformed scoped children never provide cleanup proof.
export function retainedOutboxReceiptEvidence(value: unknown, ownerId: string | null): OutboxEvidence {
  return mergeOutboxEvidence(...(Array.isArray(value) ? value : [value]).map(root => scopedOutboxReceiptEvidence(root, ownerId)));
}

export const KEY_VALUE_OUTBOX_STATE_KEY = 'pharmacystock:outbox:v2:key-value-state';
export const OUTBOX_DISPATCH_BLOCKED_CODE = 'OUTBOX_ATOMIC_COORDINATION_UNAVAILABLE';

// Container/owner discovery is separate from envelope and immutable grouping.
// Never use a different owner's active array as the selected owner's source.
export function parseKeyValueOutboxRecoveryScope(raw: string, ownerId: string): {
  records: unknown[]; quarantine: OutboxQuarantinedRecord[]; witnesses: unknown[];
  blockedKeys: Set<string>; validContainer: boolean; incomplete?: boolean; uncertainties?: OutboxInspectionUncertainty[];
} | null {
  try {
    const state: unknown = JSON.parse(raw);
    if (Array.isArray(state) || typeof state === 'string') {
      // Reject admission while discovering explicit child scopes with the same
      // bounded walk; no recursive wrapper parsing or silent limit bypass.
      const evidence = scopedOutboxQuarantineEvidence(state, ownerId);
      return { records: [], witnesses: evidence.records, blockedKeys: evidence.blockedKeys, validContainer: false,
        quarantine: evidence.records.map((item) => ({ record: item, reason: 'MALFORMED_ENVELOPE' as const })),
        ...inspectionMetadata(evidence.uncertainties ?? [], ownerId) };
    }
    if (!record(state)) return null; // Unscoped garbage stays raw, without invented ownership.
    const headerValid = state.version === 2 && (state.ownerId === null || nonblankString(state.ownerId));
    let validContainer = headerValid && Array.isArray(state.operations) && record(state.vaults)
      && Object.values(state.vaults).every(Array.isArray);
    const records: unknown[] = [];
    const quarantine: OutboxQuarantinedRecord[] = [];
    const witnesses: unknown[] = [];
    const blockedKeys = new Set<string>();
    const taint = (items: unknown[]) => {
      witnesses.push(...items);
      for (const item of items) {
        const key = storedOutboxIdempotencyKey(item);
        if (key !== undefined) {
          blockedKeys.add(key);
          quarantine.push({ record: item, reason: 'MALFORMED_ENVELOPE' });
        }
      }
    };
    const scopedInspections: OutboxEvidence[] = [];
    const scopedRecords = (value: unknown) => {
      if (headerValid && Array.isArray(value)) {
        records.push(...value);
        const inspection = outboxOperationEvidence(value, ownerId, 'ARCHIVE');
        scopedInspections.push(inspection); witnesses.push(...inspection.records);
        // Keyless rejected containers keep their existing tainted interpretation.
        // A keyed wrapper supplies its own independently rejected intent key.
        for (const item of value) if (storedOutboxIdempotencyKey(item) === undefined) {
          const tainted = quarantineOutboxEvidence(item, ownerId);
          scopedInspections.push(tainted); taint(tainted.records);
        }
      } else {
        const inspection = quarantineOutboxEvidence(value, ownerId);
        scopedInspections.push(inspection); taint(inspection.records);
      }
    };
    if (state.ownerId === ownerId) scopedRecords(state.operations);
    else if (state.operations !== undefined) {
      // Explicit child owners remain evidence inside a foreign active array.
      // They are never admitted as this owner's operations by a foreign header.
      const wrapper = { ownerId: state.ownerId, operations: state.operations };
      const independent = headerValid ? outboxWitnessEvidence(wrapper, ownerId) : scopedOutboxQuarantineEvidence(wrapper, ownerId);
      scopedInspections.push(independent); witnesses.push(...independent.records);
    }
    // Selected slots remain admission sources. Foreign slots contribute only
    // independently owned evidence, including through malformed containers.
    if (record(state.vaults)) for (const [storedOwner, value] of Object.entries(state.vaults)) {
      if (storedOwner === ownerId) scopedRecords(value);
      else {
        const inheritedOwner = nonblankString(storedOwner) ? storedOwner : undefined;
        const independent = headerValid && Array.isArray(value)
          ? outboxWitnessEvidence(value, ownerId, inheritedOwner === undefined, inheritedOwner)
          : quarantineOutboxEvidence(value, ownerId, inheritedOwner === undefined, inheritedOwner);
        scopedInspections.push(independent); witnesses.push(...independent.records);
      }
    }
    const persisted = scopedOutboxQuarantineEvidence(state.quarantine, ownerId);
    witnesses.push(...persisted.records);
    for (const key of persisted.blockedKeys) blockedKeys.add(key);
    // Preserve canonical entries in the handoff view, and retain the entire raw
    // archive physically. Direct record/raw/nested entries remain tainted.
    if (state.quarantine !== undefined) {
      if (!Array.isArray(state.quarantine)) validContainer = false;
      let remaining = OUTBOX_EVIDENCE_MAX_NODES;
      for (const entry of (Array.isArray(state.quarantine) ? state.quarantine : [state.quarantine]).slice(0, OUTBOX_EVIDENCE_MAX_NODES)) {
        if (!record(entry) || !(entry.ownerId === null || nonblankString(entry.ownerId)) || !Array.isArray(entry.records)) {
          validContainer = false;
          continue;
        }
        for (const item of entry.records.slice(0, Math.max(0, remaining))) {
          remaining--;
          if (!isOutboxQuarantineRecord(item)) validContainer = false;
          else if (headerValid && entry.ownerId === ownerId) quarantine.push(item);
        }
      }
      for (const item of persisted.records) {
        const key = storedOutboxIdempotencyKey(item);
        if (key !== undefined && persisted.blockedKeys.has(key) && !quarantine.some(prior => prior.record === item)) {
          quarantine.push({ record: item, reason: 'MALFORMED_ENVELOPE' });
        }
      }
    }
    const receipt = classifyOutboxReceiptEvidence(state.legacyGlobalRecovery);
    const global = receipt.ownerId === ownerId || receipt.ownerId === undefined ? receipt : scopedOutboxQuarantineEvidence(state.legacyGlobalRecovery, ownerId);
    const historical = mergeOutboxEvidence(global, scopedOutboxReceiptEvidence(state.legacyVaultReceipts, ownerId),
      retainedOutboxReceiptEvidence(state.legacyVaultReceiptArchives, ownerId));
    if (!headerValid) taint(historical.records);
    else witnesses.push(...historical.records);
    for (const key of historical.blockedKeys) blockedKeys.add(key);
    for (const item of historical.records) {
      const key = storedOutboxIdempotencyKey(item);
      if (key !== undefined && blockedKeys.has(key)) quarantine.push({ record: item, reason: 'MALFORMED_ENVELOPE' });
    }
    // Container validity is admission metadata, not blanket key poisoning. Only
    // safely attributable tainted fragments block keys; raw garbage never does.
    const inspection = mergeOutboxEvidence(persisted, historical, ...scopedInspections);
    for (const key of inspection.blockedKeys) blockedKeys.add(key);
    return { records, quarantine, witnesses, blockedKeys, validContainer,
      ...inspectionMetadata(inspection.uncertainties ?? [], ownerId), ...(inspection.incomplete ? { incomplete: true } : {}) };
  } catch {
    return null;
  }
}

// Historical native receipts can cross adapter/import paths without resurrecting
// consumed work. A still-retained native destination must first be handed off.
export function keyValueOutboxHistoricalEvidence(raw: string, ownerId: string): OutboxEvidence {
  const scope = parseKeyValueOutboxRecoveryScope(raw, ownerId);
  if (!scope) return { records: [], blockedKeys: new Set() };
  const state = JSON.parse(raw) as Record<string, unknown>;
  const global = classifyOutboxReceiptEvidence(state.legacyGlobalRecovery);
  const evidence = mergeOutboxEvidence(
    global.ownerId === ownerId || global.ownerId === undefined ? global : scopedOutboxQuarantineEvidence(state.legacyGlobalRecovery, ownerId),
    scopedOutboxReceiptEvidence(state.legacyVaultReceipts, ownerId),
    retainedOutboxReceiptEvidence(state.legacyVaultReceiptArchives, ownerId),
  );
  for (const key of scope.blockedKeys) evidence.blockedKeys.add(key);
  if (scope.incomplete) evidence.incomplete = true;
  if (scope.uncertainties?.length) evidence.uncertainties = [...evidence.uncertainties ?? [], ...scope.uncertainties];
  const importedIds = new Map([...evidence.importedIds ?? []].filter(([key]) => !evidence.blockedKeys.has(key)));
  for (const item of scope.records) {
    const key = storedOutboxIdempotencyKey(item);
    if (key !== undefined && (!isRecoverableLegacyOperation(item) || item.status !== 'SYNCED')) importedIds.delete(key);
  }
  return { ...evidence, importedIds };
}
