import type { TFunction } from 'i18next';
export const STOCK_UNITS = ['unit', 'tablet', 'capsule', 'bottle', 'box', 'ampoule', 'tube', 'sachet', 'ml', 'g'] as const;
export type StockUnit = typeof STOCK_UNITS[number];
export function stockUnitLabel(code: string | null | undefined, t: TFunction): string {
  return t(`catalogReady.units.${STOCK_UNITS.includes(code as StockUnit) ? code : 'unit'}`);
}
