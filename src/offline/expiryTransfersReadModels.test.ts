import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import type { KeyValueStorage } from './storage';
import { cacheTransferLines, cacheTransfersReadModel, getCachedTransferLines, getCachedTransfersReadModel } from './expiryTransfersReadModels';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

describe('transfer read models', () => {
  it('persists summaries by organization and branch', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    const transfer = { id:'transfer-1',organization_id:'org-1',source_branch_id:'branch-1',destination_branch_id:'branch-2',transfer_number:'TR-1',status:'REQUESTED' as const,notes:null,discrepancy_notes:null,requested_by:'user-1',approved_by:null,dispatched_by:null,received_by:null,requested_at:'2026-08-23',approved_at:null,dispatched_at:null,received_at:null,created_at:'2026-08-23',updated_at:'2026-08-23' };
    cacheTransfersReadModel(store,'org-1','branch-1',{transfers:[transfer],transferableBatches:[]});
    expect(getCachedTransfersReadModel(new LocalStore(storage),'org-1','branch-1')?.data.transfers[0]?.id).toBe('transfer-1');
    expect(getCachedTransfersReadModel(new LocalStore(storage),'org-1','branch-2')).toBeNull();
  });

  it('persists selected transfer lines independently', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    const line = { id:'line-1',organization_id:'org-1',transfer_id:'transfer-1',source_batch_id:'batch-1',destination_batch_id:null,product_id:'product-1',requested_quantity:2,dispatched_quantity:2,received_quantity:0,discrepancy_quantity:0,discrepancy_reason:null,transfer_out_movement_id:null,transfer_in_movement_id:null,created_at:'2026-08-23',updated_at:'2026-08-23' };
    cacheTransferLines(store,'org-1','transfer-1',[line]);
    expect(getCachedTransferLines(new LocalStore(storage),'org-1','transfer-1')?.data[0]?.source_batch_id).toBe('batch-1');
    expect(getCachedTransferLines(new LocalStore(storage),'org-2','transfer-1')).toBeNull();
  });
});
