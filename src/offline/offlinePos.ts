import type { KeyValueStorage } from './storage';
import { LocalStore } from './localStore';
import { OutboxStore, createOutboxId, type OutboxOperation } from './outbox';
import { SyncCoordinator, type ReplayOutcome } from './sync';
import { completeSale, type CartLine, type PaymentInput, type SaleQuote } from '@/services/sales';

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

function classifySaleError(error: unknown): ReplayOutcome {
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
  return { status: 'FAILED', errorCode: 'NETWORK_OR_SERVER_ERROR' };
}

export async function replayPendingSales(outbox: OutboxStore) {
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
  });
  return coordinator.replayPending();
}

export function createOfflinePosStores(storage?: KeyValueStorage) {
  return { localStore: new LocalStore(storage), outbox: new OutboxStore(storage) };
}
