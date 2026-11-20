import { createNamespacedStorage, type KeyValueStorage } from '../offline/storage';
/** Confirmed attempts are user-scoped drafts, not cached read models or replay jobs.
 * Keep them across replica cleanup so signing out cannot erase an uncertain result.
 * Only an explicit same-user recovery action sends the retained command again.
 */
export function createPosAttemptStore(storage?: KeyValueStorage) {
  const namespace = createNamespacedStorage('pharmacystock:pos-attempts:v1', storage);
  return {
    read<T>(key: string): T | null { const raw = namespace.get(key); return raw ? JSON.parse(raw) as T : null; },
    save<T>(key: string, value: T) { namespace.set(key, JSON.stringify(value)); },
    remove(key: string) { namespace.remove(key); },
  };
}
