import { describe, expect, it } from 'vitest';
import en from '../i18n/production.en.json';
import fr from '../i18n/production.fr.json';
import { errorPresentationKey } from './errorPresentation';

describe('error presentation', () => {
  it('classifies stable duplicate barcode and duplicate value failures without exposing details', () => {
    expect(errorPresentationKey(new Error('BARCODE_ALREADY_EXISTS'))).toBe('production.error.duplicateBarcode');
    expect(errorPresentationKey({ code: '23505', details: 'Key (organization_id, barcode) already exists.' })).toBe('production.error.duplicateBarcode');
    expect(errorPresentationKey({ code: '23505', details: 'Key (organization_id, name) already exists.' })).toBe('production.error.duplicateValue');
  });

  it('classifies permission, validation, authentication, and temporary failures', () => {
    expect(errorPresentationKey('OFFLINE_CACHE_EMPTY')).toBe('production.readModel.noCachedData');
    expect(errorPresentationKey({ code: '42501', message: 'permission denied' })).toBe('production.error.permissionDenied');
    expect(errorPresentationKey({ code: '22007', message: 'invalid input syntax for type date' })).toBe('production.error.validation');
    expect(errorPresentationKey(new Error('AUTH_SESSION_MISSING'))).toBe('production.error.authentication');
    expect(errorPresentationKey(new Error('Failed to fetch'))).toBe('production.error.temporary');
  });

  it('uses the localized-safe generic fallback for unknown values', () => {
    expect(errorPresentationKey({ code: 'XX999', message: 'internal constraint detail' })).toBe('production.error.generic');
    expect(errorPresentationKey('UNKNOWN_ERROR')).toBe('production.error.generic');
  });

  it('provides every error category and enum presentation in English and French', () => {
    const keys = ['generic', 'duplicateBarcode', 'duplicateValue', 'permissionDenied', 'validation', 'authentication', 'temporary'] as const;
    for (const key of keys) {
      expect(en.production.error[key]).toBeTruthy();
      expect(fr.production.error[key]).toBeTruthy();
    }
    expect(en.production.expiryAlertStatus.acknowledged).toBe('Acknowledged');
    expect(fr.production.expiryAlertStatus.acknowledged).toBe('Prise en compte');
    expect(en.production.purchasingView.supplierStatus.archived).toBe('Archived');
    expect(fr.production.purchasingView.supplierStatus.archived).toBe('Archivé');
  });
});
