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

export function queueOfflineSale(input: {
  outbox: OutboxStore;
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
  createdAt?: string;
}) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const payload: OfflineSalePayload = {
    organizationId: input.organizationId,
    branchId: input.branchId,
    saleNumber: input.saleNumber,
    lines: input.lines,
    payments: input.payments,
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
  });
}

export function pendingSaleReservations(outbox: OutboxStore, organizationId: string, branchId: string) {
  const reserved = new Map<string, number>();
  for (const operation of outbox.list()) {
    if (operation.kind !== 'SALE' || operation.organizationId !== organizationId || operation.branchId !== branchId) continue;
    if (!['PENDING', 'SYNCING', 'FAILED'].includes(operation.status)) continue;
    const payload = operation.payload as OfflineSalePayload;
    for (const line of payload.lines) reserved.set(line.product_id, (reserved.get(line.product_id) ?? 0) + line.quantity);
  }
  return reserved;
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
) {
  const auth = authClient ?? (await import('../lib/supabase')).supabase.auth;
  const { data, error } = await auth.getSession();
  if (error) throw preparationFailure('AUTH_SESSION_READ_FAILED', error);
  if (!data.session) throw new ReplayPreparationError('AUTH_SESSION_MISSING', false);

  const expiresAt = data.session.expires_at;
  if (expiresAt && expiresAt * 1000 > now.getTime() + refreshLeewaySeconds * 1000) return data.session.user.id;

  const refreshed = await auth.refreshSession();
  if (!refreshed.error && refreshed.data.session) return refreshed.data.session.user.id;
  throw preparationFailure('AUTH_SESSION_REFRESH_FAILED', refreshed.error);
}

export async function replayPendingSales(
  outbox: OutboxStore,
  options: ReplayPendingSalesOptions = {},
) {
  const { completeSale } = await import('../services/sales');
  const localStore = options.localStore ?? new LocalStore();
  const replayScope = offlineSessionScope.replayScope();
  let refreshedUserId: string | null = null;
  const coordinator = new SyncCoordinator(outbox, {
    SALE: async (operation: OutboxOperation) => {
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
    canReplay: () => offlineSessionScope.isReplayScopeCurrent(replayScope)
      && (refreshedUserId === null || refreshedUserId === replayScope.userId),
    beforeReplay: async () => {
      refreshedUserId = await refreshSessionForReplay(options.now?.() ?? new Date(), options.refreshLeewaySeconds);
      const [{ loadInventoryBalances }, { cachePosStockSnapshot }] = await Promise.all([
        import('../services/inventory'),
        import('./offlinePosCatalog'),
      ]);
      const scopes = new Map<string, { organizationId: string; branchId: string }>();
      for (const operation of outbox.pending(options.now?.() ?? new Date())) {
        if (operation.kind !== 'SALE' || !operation.branchId) continue;
        scopes.set(`${operation.organizationId}:${operation.branchId}`, {
          organizationId: operation.organizationId,
          branchId: operation.branchId,
        });
      }
      for (const scope of scopes.values()) {
        try {
          const balances = await loadInventoryBalances(scope.organizationId, scope.branchId);
          cachePosStockSnapshot(localStore, scope.organizationId, scope.branchId, balances);
        } catch (error) {
          throw preparationFailure(
            'PULL_BEFORE_REPLAY_FAILED',
            error && typeof error === 'object' ? error as { status?: number } : null,
          );
        }
      }
    },
  });
  return coordinator.replayPending();
}

export function createOfflinePosStores(storage?: KeyValueStorage) {
  return { localStore: new LocalStore(storage), outbox: new OutboxStore(storage) };
}
