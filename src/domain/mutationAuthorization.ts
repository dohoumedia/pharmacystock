export function hasFreshMutationAuthorization(
  isOnline: boolean,
  usingCachedData: boolean,
  contextSyncedAt?: string | null,
  now = Date.now(),
  maxAgeMs = 15 * 60 * 1000,
) {
  if (!isOnline || usingCachedData || !contextSyncedAt) return false;
  const timestamp = Date.parse(contextSyncedAt);
  return Number.isFinite(timestamp) && now - timestamp <= maxAgeMs;
}
