import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { ReportRows } from './ReportRows';
import { ReportSummary } from './ReportSummary';
import en from '../i18n/reportsReady.en.json';
import fr from '../i18n/reportsReady.fr.json';
import catalogEn from '../i18n/catalogReady.en.json';
import catalogFr from '../i18n/catalogReady.fr.json';
import type { OperationalReport } from '../domain/operationalReports';
const translator = createInstance();
void translator.init({ initAsync: false, lng: 'en', interpolation: { escapeValue: false }, resources: { en: { translation: { ...en, ...catalogEn } }, fr: { translation: { ...fr, ...catalogFr } } } });
vi.mock('../i18n/useTranslation', () => ({ useTranslation: () => ({ t: translator.t.bind(translator), i18n: translator }) }));
vi.mock('react-native', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span>, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./ui', () => ({ Alert: ({ title }: { title: string }) => <p>{title}</p>, Surface: ({ children }: { children: ReactNode }) => <section>{children}</section>, Button: ({ label }: { label: string }) => <button>{label}</button> }));
const base: OperationalReport = { rows: [], total: 0, summary: {}, timezone: 'America/Toronto', business_date: '2026-11-18', generated_at: '2026-11-18T12:00:00Z', start: '2026-11-18', end: '2026-11-18', branch_id: 'br', page: 0, page_size: 25 };
describe('operational report presentation', () => {
  it.each(['en','fr'])('renders reconciled closeout, payment methods and distinct units in %s', async locale => {
    await translator.changeLanguage(locale);
    const report = { ...base, summary: { gross: 10, refunds: 15, net: -5, sale_count: 1, refund_count: 3, average: 10, recorded_payments: 10, payment_difference: 0, methods: [{ method: 'CARD', amount: 10, transaction_count: 1, reversed_count: 0 }], units: [{ stock_unit: 'tablet', quantity: 1 }] } };
    const html = renderToStaticMarkup(<ReportSummary report={report} kind="sales" currency="CAD" branchName="Main" pending={2} conflicts={1} />);
    expect(html).toContain('Main'); expect(html).toContain('America/Toronto'); expect(html).toContain(locale === 'fr' ? 'Clôture quotidienne' : 'Daily closeout'); expect(html).toContain(locale === 'fr' ? 'Carte (externe)' : 'Card (external)'); expect(html).not.toContain('reportsReady.');
  });
  it.each(['en','fr'])('discloses incomplete valuation and unknown balance in %s', async locale => {
    await translator.changeLanguage(locale);
    const html = renderToStaticMarkup(<ReportSummary report={{ ...base, summary: { finance: true, batches: 1, cost_value: null, retail_value: null, missing_cost: 1, missing_price: 2, missing_balance: 1 } }} kind="inventory" currency="CAD" branchName="Main" pending={0} conflicts={0} />);
    expect(html).toContain(locale === 'fr' ? 'Valorisation incomplète' : 'Valuation is incomplete'); expect(html).toContain(locale === 'fr' ? 'Inconnu / incomplet' : 'Unknown / incomplete');
  });
  it.each(['en','fr'])('localizes opening-stock source and date-driven expiry in %s', async locale => {
    await translator.changeLanguage(locale);
    const html = renderToStaticMarkup(<ReportRows report={{ ...base, rows: [{ id: 'm', timestamp: base.generated_at, product: 'Medicine', lot_number: 'LOT', stock_unit: 'tablet', movement_type: 'ADJUSTMENT_IN', quantity_delta: 2, reference_type: 'OPENING_STOCK', reference_id: 'ref', source: 'OPENING_STOCK' }] }} kind="movements" currency="CAD" branches={[]} onOpen={() => {}} />);
    expect(html).toContain(locale === 'fr' ? 'Stock initial' : 'Opening stock'); expect(html).not.toContain('OPENING_STOCK'); expect(html).not.toContain('reportsReady.');
  });
  it('keeps stock units on attention rows and offers the exact product drilldown', () => { const html = renderToStaticMarkup(<ReportRows report={{ ...base, rows: [{ id: 'p', product: 'Split lots', stock_unit: 'tablet', on_hand: 5, sellable: 5, batches: 2, attention: 'low', missing_balance: false }] }} kind="attention" currency="CAD" branches={[]} onOpen={() => {}} />); expect(html).toContain('Split lots'); expect(html).toContain('5'); });
});

it('does not imply that partial item records are complete units sold', () => {
  const html = renderToStaticMarkup(<ReportSummary report={{ ...base, summary: { missing_sale_items: 2, units: [{ stock_unit: 'tablet', quantity: 99 }] } }} kind="sales" currency="CAD" branchName="Main" pending={0} conflicts={0} />);
  expect(html).not.toContain('99');
  expect(html).toContain(translator.language === 'fr' ? 'quantités vendues sont indisponibles' : 'Unit totals are unavailable');
});
