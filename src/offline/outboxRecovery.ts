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
  if (operation.status !== 'SYNCING' || parseOutboxTimestamp(operation.lastAttemptAt) === null) {
    // A malformed interrupted record stays durable and fail-closed, including
    // through owner switches. Never infer a timestamp or new replay identity.
    return operation;
  }
  return { ...operation, status: 'PENDING', nextAttemptAt: undefined, lastErrorCode: undefined };
}
