import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Receipt } from './Receipt';
import { CustomerEditor } from './CustomerEditor';
import { PosCustomerPicker } from './PosCustomerPicker';
import { CustomerDirectory } from './CustomerDirectory';
import type { Customer } from '../services/coreCompletion';
import type { SaleDetailData } from '../services/posCompletion';
import en from '../i18n/customersReady.en.json';
import fr from '../i18n/customersReady.fr.json';
import baseEn from '../i18n/sprint7.en.json';
import baseFr from '../i18n/sprint7.fr.json';
import posEn from '../i18n/posReady.en.json';
import posFr from '../i18n/posReady.fr.json';
const translator = createInstance();
void translator.init({ initAsync: false, lng: 'en', resources: { en: { translation: { ...en, ...baseEn, ...posEn } }, fr: { translation: { ...fr, ...baseFr, ...posFr } } } });
vi.mock('../i18n/useTranslation', () => ({ useTranslation: () => ({ t: translator.t.bind(translator), i18n: translator }) }));
vi.mock('react-native', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span>, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'stable' }));
vi.mock('../services/customerWorkflow', () => ({ customerDuplicates: vi.fn(), saveCustomerAttempt: vi.fn(), customerPage: vi.fn() }));
vi.mock('./ReadModelStatus', () => ({ ReadModelStatus: () => null }));
vi.mock('./ui', () => ({
  Button: ({ label, disabled }: { label: string; disabled: boolean }) => <button disabled={disabled}>{label}</button>,
  TextField: ({ value, editable, accessibilityLabel }: { value: string; editable: boolean; accessibilityLabel: string }) => <input aria-label={accessibilityLabel} defaultValue={value} disabled={!editable} />,
  FormField: ({ children, label, hint }: { children: ReactNode; label: string; hint: string }) => <label>{label}{children}{hint}</label>,
  Alert: ({ title }: { title: string }) => <p>{title}</p>, Stack: ({ children }: { children: ReactNode }) => <div>{children}</div>, Surface: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
const profile = { id: 'customer', full_name: 'Customer Name', phone: '5145550111', email: 'private@example.test', notes: 'Private operational note', preferred_locale: 'fr', status: 'archived' } as Customer;
const no = () => {};
beforeEach(async () => { await translator.changeLanguage('en'); });
describe('customer bilingual surfaces and receipt privacy', () => {
  it.each(['en','fr'])('renders the minimum editor and status control in %s', async locale => {
    await translator.changeLanguage(locale); const html = renderToStaticMarkup(<CustomerEditor organizationId="org" userId="user" customer={profile} writable onSaved={no} onCancel={no} onExisting={no} />);
    for (const field of ['Customer Name','5145550111','private@example.test','Private operational note']) expect(html).toContain(field);
    expect(html).toContain(translator.t('customersReady.restore')); expect(html).not.toContain('customersReady.'); expect(html).not.toContain('sprint7.');
  });
  it('keeps anonymous sale visible and customer selection optional', () => { const html = renderToStaticMarkup(<PosCustomerPicker organizationId="org" userId="user" online writable canManage locked={false} customerId={null} customer={null} onSelect={no} />); expect(html).toContain(en.customersReady.walkIn); expect(html).toContain(en.customersReady.choose); });
  it('allows clearing a selected customer and locks controls during sale recovery', () => { const html = renderToStaticMarkup(<PosCustomerPicker organizationId="org" userId="user" online writable canManage locked customerId={profile.id} customer={profile} onSelect={no} />); expect(html).toContain(en.customersReady.clear); expect(html).toContain('disabled'); expect(html).toContain(profile.full_name); });
  it('renders bounded directory search and status filters in French', async () => { await translator.changeLanguage('fr'); const html = renderToStaticMarkup(<CustomerDirectory organizationId="org" userId="user" online onSelect={no} />); expect(html).toContain(fr.customersReady.search); expect(html).toContain(fr.customersReady.archived); expect(html).not.toContain('customersReady.'); });
  it.each(['en','fr'])('shows only current customer display name on receipt in %s, with no contact or notes', async locale => { await translator.changeLanguage(locale); const detail = { sale: { completed_at: '2026-11-18T12:00:00Z', customer_id: profile.id, currency_code: 'CAD', total_amount: 10, discount_total: 0, status: 'PARTIALLY_REFUNDED' }, customer: profile, items: [], payments: [] } as unknown as SaleDetailData; const html = renderToStaticMarkup(<Receipt detail={detail} business="Pharmacy" branch="Main" />); expect(html).toContain(profile.full_name); expect(html).not.toContain(profile.email!); expect(html).not.toContain(profile.phone!); expect(html).not.toContain(profile.notes!); });
  it('prints valid walk-in identity when no customer is attached', () => { const detail = { sale: { completed_at: '2026-11-18T12:00:00Z', customer_id: null, currency_code: 'CAD', total_amount: 10 }, items: [], payments: [] } as unknown as SaleDetailData; expect(renderToStaticMarkup(<Receipt detail={detail} business="Pharmacy" branch="Main" />)).toContain(en.customersReady.walkIn); });
  it('has matching EN/FR keys and placeholders', () => { expect(Object.keys(fr.customersReady).sort()).toEqual(Object.keys(en.customersReady).sort()); for (const key of Object.keys(en.customersReady) as (keyof typeof en.customersReady)[]) { expect(fr.customersReady[key]).toBeTruthy(); if (typeof en.customersReady[key] === 'string') expect(String(fr.customersReady[key]).match(/{{\w+}}/g) ?? []).toEqual(String(en.customersReady[key]).match(/{{\w+}}/g) ?? []); } expect(Object.keys(fr.customersReady.errors)).toEqual(Object.keys(en.customersReady.errors)); });
});
