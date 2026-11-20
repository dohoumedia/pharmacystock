import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { AdjustmentConfirmation } from './InventoryResultDetails';
import { CountVariance } from './PhysicalCounts';
import en from '../i18n/inventoryReady.en.json';
import fr from '../i18n/inventoryReady.fr.json';
import baseEn from '../i18n/en.json';
import baseFr from '../i18n/fr.json';
import type { AdjustmentRequest, CountDraft } from '../domain/inventoryCompletion';
const translator = createInstance();
void translator.init({ initAsync: false, lng: 'en', resources: { en: { translation: { ...baseEn, ...en } }, fr: { translation: { ...baseFr, ...fr } } } });
vi.mock('../i18n/useTranslation', () => ({ useTranslation: () => ({ t: translator.t.bind(translator), i18n: translator }) }));
vi.mock('react-native', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span>, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('expo-router', () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
vi.mock('./CatalogSelector', () => ({ CatalogSelector: () => null }));
vi.mock('./ui', () => ({ Surface: ({ children }: { children: ReactNode }) => <section>{children}</section> }));
vi.mock('@/services/catalogReadiness', () => ({ searchBatches: vi.fn() }));
vi.mock('@/services/inventoryCompletion', () => ({}));
const batch = { id: 'batch', organization_id: 'org', branch_id: 'a', product_id: 'product', product_name: 'Medicine', lot_number: 'LOT-140', status: 'ACTIVE', stock_unit: 'tablet', expiry_date: '2028-01-01', purchase_cost: 1, selling_price: 2, notes: null, created_at: '', updated_at: '' };
describe('inventory result presentation', () => {
  it('shows structured acceptance even when the detail refresh is unavailable', () => {
    const request: AdjustmentRequest = { organizationId: 'org', branchId: 'a', batch, quantityDelta: -2.5, reason: 'Broken package', reference: 'CORR-1', idempotencyKey: 'key', occurredAt: '', observedOnHand: 10, resultId: 'movement-accepted' };
    const html = renderToStaticMarkup(<AdjustmentConfirmation request={request} movement={null} balance={null} />);
    for (const text of ['Adjustment accepted', 'Medicine', 'LOT-140', '10', '-2.5', '7.5', 'Broken package', 'movement-accepted']) expect(html).toContain(text);
    expect(html).toContain(en.inventoryReady.snapshotNote);
  });
  it('shows signed variance and French decimal comma without raw keys', async () => {
    await translator.changeLanguage('fr');
    const draft: CountDraft = { id: 'count', organizationId: 'org', branchId: 'a', createdAt: '', phase: 'review', entries: [{ batch, raw: '8,125', expected: 10 }, { batch: { ...batch, id: 'b', lot_number: 'LOT-141' }, raw: '12,5', expected: 10 }] };
    const html = renderToStaticMarkup(<CountVariance draft={draft} />);
    expect(html).toContain('-1,875'); expect(html).toContain('+2,5'); expect(html).toContain(fr.inventoryReady.expected); expect(html).not.toContain('inventoryReady.');
    await translator.changeLanguage('en');
  });
  it('never displays an incomplete entry or missing balance as zero', () => {
    const draft: CountDraft = { id: 'count', organizationId: 'org', branchId: 'a', createdAt: '', phase: 'editing', entries: [{ batch, raw: '', expected: null }] };
    const html = renderToStaticMarkup(<CountVariance draft={draft} />); expect(html).toContain(en.inventoryReady.unavailable); expect(html).toContain(en.inventoryReady.incomplete);
  });
});
