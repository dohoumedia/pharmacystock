import { describe, expect, it } from 'vitest';
import { canApplyTransferAction, isTransferBatchEligible, validateReceivedQuantity } from './transferSafety';

describe('transfer safety presentation guards', () => {
  it('excludes expired, quarantined, depleted, and empty batches', () => {
    expect(isTransferBatchEligible({ status: 'ACTIVE', expiry_date: '2026-08-23', balance: 1 }, '2026-08-23')).toBe(true);
    expect(isTransferBatchEligible({ status: 'ACTIVE', expiry_date: '2026-08-22', balance: 1 }, '2026-08-23')).toBe(false);
    expect(isTransferBatchEligible({ status: 'QUARANTINED', expiry_date: '2027-01-01', balance: 1 }, '2026-08-23')).toBe(false);
    expect(isTransferBatchEligible({ status: 'ACTIVE', expiry_date: '2027-01-01', balance: 0 }, '2026-08-23')).toBe(false);
  });

  it('mirrors the server transfer state-machine for available actions', () => {
    expect(canApplyTransferAction('REQUESTED', 'approve')).toBe(true);
    expect(canApplyTransferAction('APPROVED', 'dispatch')).toBe(true);
    expect(canApplyTransferAction('DISPATCHED', 'receive')).toBe(true);
    expect(canApplyTransferAction('RECEIVED', 'dispatch')).toBe(false);
    expect(canApplyTransferAction('DISPATCHED', 'cancel')).toBe(false);
  });

  it('rejects invalid receipt quantities before invoking the server', () => {
    expect(validateReceivedQuantity(3, 4)).toBe(true);
    expect(validateReceivedQuantity(-1, 4)).toBe(false);
    expect(validateReceivedQuantity(5, 4)).toBe(false);
    expect(validateReceivedQuantity(Number.NaN, 4)).toBe(false);
  });
});
