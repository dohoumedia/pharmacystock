import type { OutboxStoreOptions } from './outbox';
import type { OutboxQuarantinedRecord } from './outboxRecovery';
import type { KeyValueStorage } from './storage';

// Test-only inspection of durable quarantine; never exposed by normal outbox lists.
export async function persistedQuarantine(
  storage: KeyValueStorage,
  options: OutboxStoreOptions = {},
  ownerId: string | null = 'user-a',
): Promise<OutboxQuarantinedRecord[]> {
  if (!options.indexedDB) {
    const state = JSON.parse(storage.getItem('pharmacystock:outbox:v2:key-value-state') ?? '{}') as {
      quarantine?: { ownerId: string | null; records: OutboxQuarantinedRecord[] }[];
    };
    return state.quarantine?.find((item) => item.ownerId === ownerId)?.records ?? [];
  }
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = options.indexedDB!.open(options.databaseName ?? 'pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<OutboxQuarantinedRecord[]>((resolve, reject) => {
      const tx = database.transaction('metadata', 'readonly');
      const request = tx.objectStore('metadata').get('persisted-outbox-v2:quarantine:' + JSON.stringify(ownerId));
      tx.oncomplete = () => resolve((request.result as { records?: OutboxQuarantinedRecord[] } | undefined)?.records ?? []);
      tx.onabort = () => reject(tx.error);
    });
  } finally { database.close(); }
}

export function quarantineOperationRecords(records: OutboxQuarantinedRecord[]): unknown[] {
  return records.map(({ record }) => {
    if (record && typeof record === 'object' && 'ownerId' in record) {
      const { ownerId: _ownerId, ...operation } = record;
      return operation;
    }
    return record;
  });
}

