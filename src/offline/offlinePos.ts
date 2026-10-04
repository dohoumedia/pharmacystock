import type { KeyValueStorage } from './storage';
import { LocalStore } from './localStore';
import { OutboxStore, createOutboxId, type OutboxOperation } from './outbox';
import { SyncCoordinator, ReplayPreparationError, type ReplayResult } from './sync';
import { offlineSessionScope } from './sessionScope';
import type { CartLine, PaymentInput, SaleQuote } from '../services/sales';

export type OfflineSalePayload = {
  organizationId: string;
  branchId: string;
  saleNumber: string;
  lines: CartLine[];
  payments: PaymentInput[];
  customerId: string | null;
  notes?: string;
  localReceiptNumber: string;
  quotedTotal: number;
  quoteSyncedAt: string;
};

export type SaleSubmissionIdentity = {
  fingerprint: string;
  saleNumber: string;
  idempotencyKey: string;
};

export type OfflineStockReservationFailure =
  | 'NO_STOCK_SNAPSHOT'
  | 'LOCAL_INSUFFICIENT_STOCK'
  | 'LOCAL_RESERVATION_STATE_INVALID';

export class OfflineStockReservationError extends Error {
  constructor(
    readonly reason: OfflineStockReservationFailure,
    readonly productId?: string,
    readonly available?: number,
  ) {
    super(reason);
    this.name = 'OfflineStockReservationError';
  }
}

export function applySaleDraftMutation(submissionInFlight: boolean, mutation: () => void): boolean {
  if (submissionInFlight) return false;
  mutation();
  return true;
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

export function resolveSaleSubmissionIdentity(input: {
  branchId: string;
  immutableContent: unknown;
  previous?: SaleSubmissionIdentity | null;
  createUuid: () => string;
}): SaleSubmissionIdentity {
  const fingerprint = stableSerialize(input.immutableContent);
  if (input.previous?.fingerprint === fingerprint) return input.previous;
  const submissionId = input.createUuid();
  return {
    fingerprint,
    saleNumber: `SALE-${submissionId}`,
    idempotencyKey: `sale:${input.branchId}:${submissionId}`,
  };
}

const quoteKey = (organizationId: string, branchId: string, lines: CartLine[]) => {
  const normalized = [...lines]
    .map((line) => ({ product_id: line.product_id, quantity: line.quantity }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
  return `pos:quote:${organizationId}:${branchId}:${JSON.stringify(normalized)}`;
};

export function cacheSaleQuote(
  store: LocalStore,
  organizationId: string,
  branchId: string,
  lines: CartLine[],
  quote: SaleQuote,
  syncedAt = new Date().toISOString(),
) {
  store.set(quoteKey(organizationId, branchId, lines), { data: quote, syncedAt });
}

export function getCachedSaleQuote(
  store: LocalStore,
  organizationId: string,
  branchId: string,
  lines: CartLine[],
) {
  return store.get<SaleQuote>(quoteKey(organizationId, branchId, lines));
}

export type QueueOfflineSaleInput = {
  outbox: OutboxStore;
  userId: string;
  organizationId: string;
  branchId: string;
  saleNumber: string;
  lines: CartLine[];
  payments: PaymentInput[];
  idempotencyKey: string;
  customerId?: string | null;
  notes?: string;
  quote: SaleQuote;
  quoteSyncedAt: string;
  trustedAvailableByProduct: Readonly<Record<string, number>> | null;
  requireCrossContextAtomicity: boolean;
  createdAt?: string;
};

const reservationStatuses = new Set<OutboxOperation['status']>(['PENDING', 'SYNCING', 'FAILED']);

function collectSaleReservations(
  operations: readonly OutboxOperation[],
  organizationId: string,
  branchId: string,
  strict = false,
) {
  const reserved = new Map<string, number>();
  for (const operation of operations) {
    if (operation.kind !== 'SALE' || operation.organizationId !== organizationId || operation.branchId !== branchId) continue;
    if (!reservationStatuses.has(operation.status)) continue;
    const payload = operation.payload as Partial<OfflineSalePayload>;
    if (!Array.isArray(payload.lines)) {
      if (strict) throw new OfflineStockReservationError('LOCAL_RESERVATION_STATE_INVALID');
      continue;
    }
    for (const line of payload.lines) {
      const productId = line?.product_id;
      const quantity = Number(line?.quantity);
      if (typeof productId !== 'string' || !productId || !Number.isFinite(quantity) || quantity <= 0) {
        if (strict) throw new OfflineStockReservationError('LOCAL_RESERVATION_STATE_INVALID');
        continue;
      }
      reserved.set(productId, (reserved.get(productId) ?? 0) + quantity);
    }
  }
  return reserved;
}

function validateSaleReservation(
  operations: readonly OutboxOperation[],
  input: QueueOfflineSaleInput,
) {
  if (!input.trustedAvailableByProduct) {
    throw new OfflineStockReservationError('NO_STOCK_SNAPSHOT');
  }

  const requested = new Map<string, number>();
  for (const line of input.lines) {
    const quantity = Number(line.quantity);
    if (!line.product_id || !Number.isFinite(quantity) || quantity <= 0) {
      throw new OfflineStockReservationError('LOCAL_RESERVATION_STATE_INVALID', line.product_id);
    }
    requested.set(line.product_id, (requested.get(line.product_id) ?? 0) + quantity);
  }

  const reserved = collectSaleReservations(operations, input.organizationId, input.branchId, true);
  for (const [productId, quantity] of requested) {
    const snapshotQuantity = Number(input.trustedAvailableByProduct[productId] ?? 0);
    if (!Number.isFinite(snapshotQuantity) || snapshotQuantity < 0) {
      throw new OfflineStockReservationError('LOCAL_RESERVATION_STATE_INVALID', productId);
    }
    const remaining = Math.max(0, snapshotQuantity - (reserved.get(productId) ?? 0));
    if (quantity > remaining) {
      throw new OfflineStockReservationError('LOCAL_INSUFFICIENT_STOCK', productId, remaining);
    }
  }
}

export function queueOfflineSale(input: QueueOfflineSaleInput) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const lines = input.lines.map((line) => ({ ...line }));
  const payments = input.payments.map((payment) => ({ ...payment }));
  const trustedAvailableByProduct = input.trustedAvailableByProduct
    ? { ...input.trustedAvailableByProduct }
    : null;
  const payload: OfflineSalePayload = {
    organizationId: input.organizationId,
    branchId: input.branchId,
    saleNumber: input.saleNumber,
    lines,
    payments,
    customerId: input.customerId ?? null,
    notes: input.notes,
    localReceiptNumber: input.saleNumber,
    quotedTotal: Number(input.quote.total_amount),
    quoteSyncedAt: input.quoteSyncedAt,
  };

  return input.outbox.enqueue({
    id: createOutboxId('sale'),
    kind: 'SALE',
    organizationId: input.organizationId,
    branchId: input.branchId,
    idempotencyKey: input.idempotencyKey,
    payload,
    createdAt,
  }, input.userId, {
    validate: (operations) => validateSaleReservation(operations, {
      ...input,
      lines,
      payments,
      trustedAvailableByProduct,
    }),
    requireCrossContextAtomicity: input.requireCrossContextAtomicity,
  });
}

export async function queueOfflineSaleForCheckout(
  input: QueueOfflineSaleInput,
  onDurablyQueued: () => void,
) {
  const operation = await queueOfflineSale(input);
  onDurablyQueued();
  return operation;
}

export function pendingSaleReservations(outbox: OutboxStore, organizationId: string, branchId: string) {
  return collectSaleReservations(outbox.list(), organizationId, branchId);
}

function classifySaleError(error: unknown): ReplayResult {
  const message = error instanceof Error ? error.message : String(error);
  const upper = message.toUpperCase();
  const deterministic = [
    'INSUFFICIENT_STOCK',
    'EXPIRED',
    'QUARANTIN',
    'RECALL',
    'PERMISSION',
    'AUTHORIZED',
    'PRICE',
    'INVALID',
  ].find((token) => upper.includes(token));

  if (deterministic) return { status: 'CONFLICT', errorCode: deterministic };
  return { status: 'FAILED', errorCode: 'NETWORK_OR_SERVER_ERROR', retryable: true };
}

type ReplayPendingSalesOptions = {
  localStore?: LocalStore;
  now?: () => Date;
  refreshLeewaySeconds?: number;
  expectedOwnerId?: string;
  canReplay?: () => boolean;
};

type ReplayAuthClient = {
  getSession: () => Promise<{
    data: { session: { expires_at?: number; user: { id: string } } | null };
    error: { status?: number } | null;
  }>;
  refreshSession: () => Promise<{
    data: { session: { expires_at?: number; user: { id: string } } | null };
    error: { status?: number } | null;
  }>;
};

function preparationFailure(code: string, error: { status?: number } | null) {
  const status = error?.status;
  const retryable = status === undefined || status >= 500 || status === 408 || status === 425 || status === 429;
  return new ReplayPreparationError(code, retryable);
}

export async function refreshSessionForReplay(
  now = new Date(),
  refreshLeewaySeconds = 60,
  authClient?: ReplayAuthClient,
  canReplay: () => boolean = () => true,
  expectedOwnerId?: string,
) {
  const assertCurrent = () => {
    if (!canReplay()) throw new ReplayPreparationError('REPLAY_OBSOLETE', false);
  };
  assertCurrent();
  const auth = authClient ?? (await import('../lib/supabase')).supabase.auth;
  assertCurrent();
  const { data, error } = await auth.getSession();
  assertCurrent();
  if (error) throw preparationFailure('AUTH_SESSION_READ_FAILED', error);
  if (!data.session) throw new ReplayPreparationError('AUTH_SESSION_MISSING', false);
  if (expectedOwnerId !== undefined && data.session.user.id !== expectedOwnerId) {
    throw new ReplayPreparationError('AUTH_SESSION_OWNER_CHANGED', false);
  }

  const expiresAt = data.session.expires_at;
  if (expiresAt && expiresAt * 1000 > now.getTime() + refreshLeewaySeconds * 1000) return data.session.user.id;

  const refreshed = await auth.refreshSession();
  assertCurrent();
  if (refreshed.data.session && expectedOwnerId !== undefined && refreshed.data.session.user.id !== expectedOwnerId) {
    throw new ReplayPreparationError('AUTH_SESSION_OWNER_CHANGED', false);
  }
  if (!refreshed.error && refreshed.data.session) return refreshed.data.session.user.id;
  throw preparationFailure('AUTH_SESSION_REFRESH_FAILED', refreshed.error);
}

export async function replayPendingSales(
  outbox: OutboxStore,
  options: ReplayPendingSalesOptions = {},
) {
  // Capture identity synchronously, before imports or any durable/auth await.
  // This invocation can never adopt a later account's generation.
  const replayScope = offlineSessionScope.replayScope();
  const empty = { synced: 0, conflicts: 0, failed: 0 };
  let refreshedUserId: string | null = null;
  let authScopeObsolete = false;
  const canReplay = () => !authScopeObsolete && (options.canReplay?.() ?? true)
    && offlineSessionScope.isReplayScopeCurrent(replayScope)
    && (options.expectedOwnerId === undefined || options.expectedOwnerId === replayScope.userId)
    && (refreshedUserId === null || refreshedUserId === replayScope.userId);
  if (!canReplay() || !replayScope.userId) return empty;
  const owner = await outbox.owner();
  if (!canReplay() || owner !== replayScope.userId) return empty;
  const { completeSale } = await import('../services/sales');
  if (!canReplay()) return empty;
  const localStore = options.localStore ?? new LocalStore();
  const coordinator = new SyncCoordinator(outbox, {
    SALE: async (operation: OutboxOperation) => {
      if (!canReplay()) throw new ReplayPreparationError('REPLAY_OBSOLETE', false);
      const payload = operation.payload as OfflineSalePayload;
      try {
        const serverId = await completeSale({
          organizationId: payload.organizationId,
          branchId: payload.branchId,
          saleNumber: payload.saleNumber,
          lines: payload.lines,
          payments: payload.payments,
          idempotencyKey: operation.idempotencyKey,
          customerId: payload.customerId,
          notes: payload.notes,
        });
        return { status: 'SYNCED', serverId };
      } catch (error) {
        return classifySaleError(error);
      }
    },
  }, {
    now: options.now,
    canReplay,
    beforeReplay: async () => {
      if (!canReplay()) return;
      try {
        refreshedUserId = await refreshSessionForReplay(
          options.now?.() ?? new Date(), options.refreshLeewaySeconds,
          undefined, canReplay, replayScope.userId ?? undefined,
        );
      } catch (error) {
        if (error instanceof ReplayPreparationError && error.code === 'AUTH_SESSION_OWNER_CHANGED') {
          // The auth account boundary may precede its lifecycle notification.
          // Cancel this invocation without changing the old owner's intent.
          authScopeObsolete = true;
          return;
        }
        throw error;
      }
      if (!canReplay()) return;
      const [{ loadInventoryBalances }, { cachePosStockSnapshot }] = await Promise.all([
        import('../services/inventory'),
        import('./offlinePosCatalog'),
      ]);
      if (!canReplay()) return;
      const scopes = new Map<string, { organizationId: string; branchId: string }>();
      for (const operation of outbox.pending(options.now?.() ?? new Date())) {
        if (operation.kind !== 'SALE' || !operation.branchId) continue;
        scopes.set(`${operation.organizationId}:${operation.branchId}`, {
          organizationId: operation.organizationId,
          branchId: operation.branchId,
        });
      }
      for (const scope of scopes.values()) {
        if (!canReplay()) return;
        try {
          const balances = await loadInventoryBalances(scope.organizationId, scope.branchId);
          if (!canReplay()) return;
          cachePosStockSnapshot(localStore, scope.organizationId, scope.branchId, balances);
        } catch (error) {
          throw preparationFailure(
            'PULL_BEFORE_REPLAY_FAILED',
            error && typeof error === 'object' ? error as { status?: number } : null,
          );
        }
      }
    },
    expectedOwnerId: replayScope.userId,
  });
  return coordinator.replayPending();
}

export function createOfflinePosStores(storage?: KeyValueStorage) {
  return { localStore: new LocalStore(storage), outbox: new OutboxStore(storage) };
}
