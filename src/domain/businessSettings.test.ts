import { describe, expect, it } from 'vitest';
import { configuredCurrency, defaultPaymentMethod, effectiveTimezone, parseLowStockThreshold, validTimezone, validateBusiness } from './businessSettings';
import { getStockAttention } from './dashboardPresentation';
import { expiryCategory, expiryThresholds } from './expiryCompletion';
import { businessDate } from './operationalReports';
import { formatPosCurrency, formatPosDate } from '../utils/posPresentation';
import { formatCurrency } from './operationsPresentation';
import en from '../i18n/settingsReady.en.json';
import fr from '../i18n/settingsReady.fr.json';
describe('business configuration consumption', () => {
  it('validates IANA zones and applies branch, organization, then UTC fallback', () => {
    expect(validTimezone('Africa/Porto-Novo')).toBe(true); expect(validTimezone('UTC')).toBe(true);
    for (const zone of ['', 'Invalid/Zone', 'EST', '+03:00']) expect(validTimezone(zone)).toBe(false);
    expect(effectiveTimezone('America/Toronto','Pacific/Honolulu')).toBe('Pacific/Honolulu');
    expect(effectiveTimezone('America/Toronto',null)).toBe('America/Toronto'); expect(effectiveTimezone('invalid','bad')).toBe('UTC');
    const now = new Date('2026-11-18T02:00Z'); expect(businessDate(now,effectiveTimezone('America/Toronto'))).toBe('2026-11-17');
    expect(formatPosDate(now.toISOString(),'en','Pacific/Honolulu')).toContain('Nov 17');
  });
  it('never invents a missing currency and preserves a recorded transaction currency', () => {
    expect(configuredCurrency(null)).toBe(''); expect(configuredCurrency('EUR')).toBe('EUR'); expect(configuredCurrency('ZZZ')).toBe('');
    expect(formatPosCurrency(10,'','fr')).toBe('—'); expect(formatCurrency(10,'en','')).toBe('—');
    expect(formatPosCurrency(10,'CAD','en')).toContain('10'); expect(formatPosCurrency(10,'EUR','fr')).toContain('€');
    expect(() => validateBusiness({ name:'Pharmacy',timezone:'UTC',currency_code:'',country_code:null })).toThrow('CURRENCY');
  });
  it('uses one supported payment default and handles unavailable defaults without changing available choices', () => {
    expect(defaultPaymentMethod('CARD')).toBe('CARD'); expect(defaultPaymentMethod('REMOVED')).toBe('CASH');
    expect(defaultPaymentMethod('CARD',['MOBILE_MONEY','OTHER'])).toBe('MOBILE_MONEY'); expect(defaultPaymentMethod('CASH',[])).toBeNull();
  });
  it('parses French decimals and propagates the same product aggregate threshold', () => {
    const threshold = parseLowStockThreshold('2,5000'); expect(threshold).toBe(2.5);
    for (const text of ['','-1','1e3','1,000.00','1.00001']) expect(() => parseLowStockThreshold(text)).toThrow();
    const rows = [{ selling_price:1,product_id:'p',batch_id:'a',available_quantity:1,batch_status:'ACTIVE',expiry_date:'2099-01-01' },{ selling_price:1,product_id:'p',batch_id:'b',available_quantity:1,batch_status:'ACTIVE',expiry_date:'2099-01-01' }];
    expect(getStockAttention(rows as never, threshold).lowStock).toBe(1); expect(getStockAttention(rows as never, 1).lowStock).toBe(0);
    expect(getStockAttention([{...rows[0],available_quantity:null}] as never, threshold).lowStock).toBe(0);
  });
  it('uses the persisted expiry bands for soon labels and report defaults', () => {
    const days = expiryThresholds('60, 7, 60'); expect(days).toEqual([60,7]); expect(expiryCategory(45,days).kind).toBe('SOON');
    expect(expiryCategory(45,[30,7]).kind).toBe('NORMAL'); expect(Math.max(...days)).toBe(60);
  });
  it('has identical EN/FR coverage and explicit external delivery/tax limitations', () => {
    const keys = (o: object,prefix=''):string[] => Object.entries(o).flatMap(([k,v]) => typeof v==='object' ? keys(v,`${prefix}${k}.`) : [`${prefix}${k}`]);
    expect(keys(fr).sort()).toEqual(keys(en).sort()); expect(en.settingsReady.deliveryUnavailable).toContain('unavailable'); expect(fr.settingsReady.deliveryUnavailable).toContain('indisponibles');
    expect(en.settingsReady.taxLimit).toContain('not supported');
  });
});
