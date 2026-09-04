import { describe, expect, it } from 'vitest';
import productionEn from '../i18n/production.en.json';
import productionFr from '../i18n/production.fr.json';
import { formatInventoryMovementType, INVENTORY_MOVEMENT_TYPES } from './inventoryMovementPresentation';

type MovementLabels = Record<string, string>;

const enLabels = productionEn.production.inventoryView.movementType as MovementLabels;
const frLabels = productionFr.production.inventoryView.movementType as MovementLabels;
const translate = (labels: MovementLabels) => (key: string) => labels[key.split('.').at(-1) ?? ''] ?? key;

describe('inventory movement presentation', () => {
  it('uses human-readable English labels for known movement types', () => {
    const t = translate(enLabels);
    expect(formatInventoryMovementType('SALE', t)).toBe('Sale');
    expect(formatInventoryMovementType('PURCHASE_RECEIPT', t)).toBe('Purchase receipt');
    expect(formatInventoryMovementType('SUPPLIER_RETURN', t)).toBe('Supplier return');
  });

  it('uses natural French labels for known movement types', () => {
    const t = translate(frLabels);
    expect(formatInventoryMovementType('SALE', t)).toBe('Vente');
    expect(formatInventoryMovementType('PURCHASE_RECEIPT', t)).toBe('Réception fournisseur');
    expect(formatInventoryMovementType('SUPPLIER_RETURN', t)).toBe('Retour fournisseur');
  });

  it('provides localized labels for every currently supported movement type', () => {
    for (const movementType of INVENTORY_MOVEMENT_TYPES) {
      expect(formatInventoryMovementType(movementType, translate(enLabels))).not.toBe(movementType);
      expect(formatInventoryMovementType(movementType, translate(frLabels))).not.toBe(movementType);
    }
  });

  it('uses a safe localized fallback for unknown future movement types', () => {
    expect(formatInventoryMovementType('FUTURE_INTERNAL_CODE', translate(enLabels))).toBe('Other inventory movement');
    expect(formatInventoryMovementType('FUTURE_INTERNAL_CODE', translate(frLabels))).toBe('Autre mouvement de stock');
  });
});
