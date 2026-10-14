import type { OutboxOperation } from '../outbox';

// Persisted shape from 622ecc7 (main immediately before PR #89), after global
// v1 import, an unchanged update, then owner A -> B. No historical runtime is
// needed: current recovery consumes the durable rows/receipts, not old methods.
// The original import leaves PENDING/SYNCING and malformed fields unchanged.
export function prePr89OutboxV2Fixture(operation: OutboxOperation) {
  const imported: OutboxOperation = JSON.parse(JSON.stringify(operation));
  return {
    keyValueState: {
      version: 2, ownerId: 'user-b', operations: [], vaults: { 'user-a': [imported] },
    },
    vaultOperation: { ...imported, ownerId: 'user-a' },
    metadata: [
      { key: 'active-owner', userId: 'user-b', legacySnapshotOwner: false },
      { key: 'legacy-local-storage-v1', completedAt: '2026-10-04T12:00:00.000Z' },
      { key: `legacy-local-storage-v1:import:${imported.idempotencyKey}`,
        sourceFingerprint: historicalSerialize(imported), importedId: imported.id },
    ],
  };
}

// Historical fingerprint encoding is intentionally independent of the current
// recovery serializer, so a future format change cannot silently rewrite it.
function historicalSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(historicalSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${historicalSerialize(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
