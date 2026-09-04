export const INVENTORY_MOVEMENT_TYPES = [
  'PURCHASE_RECEIPT',
  'SALE',
  'RETURN_IN',
  'RETURN_OUT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'DAMAGE',
  'EXPIRY',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'COUNT_CORRECTION_IN',
  'COUNT_CORRECTION_OUT',
  'SUPPLIER_RETURN',
  'DISPOSAL',
] as const;

export type SupportedInventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

type Translate = (key: string) => string;

const movementTranslationKeys: Record<SupportedInventoryMovementType, string> = {
  PURCHASE_RECEIPT: 'production.inventoryView.movementType.purchaseReceipt',
  SALE: 'production.inventoryView.movementType.sale',
  RETURN_IN: 'production.inventoryView.movementType.returnIn',
  RETURN_OUT: 'production.inventoryView.movementType.returnOut',
  TRANSFER_IN: 'production.inventoryView.movementType.transferIn',
  TRANSFER_OUT: 'production.inventoryView.movementType.transferOut',
  DAMAGE: 'production.inventoryView.movementType.damage',
  EXPIRY: 'production.inventoryView.movementType.expiry',
  ADJUSTMENT_IN: 'production.inventoryView.movementType.adjustmentIn',
  ADJUSTMENT_OUT: 'production.inventoryView.movementType.adjustmentOut',
  COUNT_CORRECTION_IN: 'production.inventoryView.movementType.countCorrectionIn',
  COUNT_CORRECTION_OUT: 'production.inventoryView.movementType.countCorrectionOut',
  SUPPLIER_RETURN: 'production.inventoryView.movementType.supplierReturn',
  DISPOSAL: 'production.inventoryView.movementType.disposal',
};

export function formatInventoryMovementType(value: string, t: Translate): string {
  const key = movementTranslationKeys[value as SupportedInventoryMovementType];
  return t(key ?? 'production.inventoryView.movementType.unknown');
}
