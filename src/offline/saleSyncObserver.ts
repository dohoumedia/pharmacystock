import { OutboxStore, type OutboxOperation } from './outbox';
import { offlineSessionScope } from './sessionScope';

// Observe durable completions only. This never creates or invokes a coordinator.
export function observeSyncedSales(
  outbox: OutboxStore,
  ownerId: string,
  organizationId: string,
  branchId: string,
  onSynced: () => void,
): () => void {
  const scope = offlineSessionScope.replayScope();
  let active = true;
  let evaluation = 0;
  const completedIds = (operations: OutboxOperation[]) => new Set(operations
    .filter((operation) => operation.kind === 'SALE' && operation.status === 'SYNCED'
      && operation.organizationId === organizationId && operation.branchId === branchId)
    .map((operation) => operation.id));
  let completed = completedIds(outbox.list());
  const current = () => active && scope.userId === ownerId
    && offlineSessionScope.isReplayScopeCurrent(scope);
  const refresh = async () => {
    const token = ++evaluation;
    if (!current()) return;
    try {
      const operations = await outbox.refresh(ownerId);
      if (!current() || token !== evaluation) return;
      const next = completedIds(operations);
      const added = [...next].some((id) => !completed.has(id));
      completed = next;
      if (added) onSynced();
    } catch {
      // Advisory UI observation must not affect replay or its durable result.
    }
  };
  const unsubscribe = outbox.subscribe(() => { void refresh(); });
  void refresh();
  return () => { active = false; evaluation += 1; unsubscribe(); };
}
