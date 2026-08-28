import { describe, expect, it } from 'vitest';
import { formatAuditEvent, formatCurrency, formatCustomerLocale, formatImportStatus, formatImportType, formatNotificationChannel, formatNotificationText, formatReportDate, formatReportMoney, formatSubscriptionStatus, isSettingsReadStale, reportsLayoutForWidth } from './operationsPresentation';

describe('operations presentation helpers', () => {
  const now = Date.parse('2026-08-23T18:10:00.000Z');

  it('uses dense report presentation on wider screens', () => {
    expect(reportsLayoutForWidth(390)).toBe('mobile');
    expect(reportsLayoutForWidth(1024)).toBe('desktop');
  });

  it('formats server-provided report values for the selected locale and currency', () => {
    expect(formatReportMoney(1234, 'en-US', 'USD')).toContain('1,234');
    expect(formatReportDate('2026-08-23', 'en-US')).toContain('Aug');
  });

  it('marks missing and expired settings snapshots stale', () => {
    expect(isSettingsReadStale(null, now)).toBe(true);
    expect(isSettingsReadStale('2026-08-23T17:00:00.000Z', now)).toBe(true);
    expect(isSettingsReadStale('2026-08-23T18:05:00.000Z', now)).toBe(false);
  });

  it('localizes server status and audit codes without exposing the raw enums', () => {
    const en = (key: string) => ({
      'production.operations.subscriptionStatus.notActivated': 'Not activated',
      'production.operations.importType.openingStock': 'Opening stock',
      'production.operations.importStatus.ready': 'Ready to import',
      'production.operations.auditEntity.product': 'Product',
      'production.operations.auditAction.updated': 'updated',
      'production.operations.auditEvent': '{{entity}} {{action}}',
    }[key] ?? 'Unavailable');
    const interpolate = (key: string, options?: Record<string, unknown>) => key === 'production.operations.auditEvent'
      ? `${options?.entity} ${options?.action}` : en(key);
    expect(formatSubscriptionStatus('NOT_ACTIVATED', en)).toBe('Not activated');
    expect(formatImportType('OPENING_STOCK', en)).toBe('Opening stock');
    expect(formatImportStatus('READY', en)).toBe('Ready to import');
    expect(formatAuditEvent('products.update', 'products', interpolate)).toBe('Product updated');
  });

  it('uses Intl currency presentation and retains an unknown ISO code safely', () => {
    expect(formatCurrency(35000, 'fr-FR', 'XOF')).toContain('35');
    expect(formatCurrency(12, 'en-US', 'INVALID')).toContain('INVALID');
  });

  it('only translates supported notification keys and never displays raw keys', () => {
    const t = (key: string, options?: Record<string, unknown>) => key === 'expiry.warning'
      ? `Expires in ${options?.days} days`
      : key === 'production.operations.notificationUnavailable' ? 'Notification details unavailable' : 'Expiry alert';
    expect(formatNotificationText('expiry.warning', { days: 7 }, t)).toBe('Expires in 7 days');
    expect(formatNotificationText('internal.raw_code', {}, t)).toBe('Notification details unavailable');
  });

  it('localizes notification channels and customer language codes', () => {
    const t = (key: string) => ({
      'production.operations.channel.email': 'Email',
      'production.operations.customerLocale.french': 'French',
    }[key] ?? 'Unavailable');
    expect(formatNotificationChannel('email', t)).toBe('Email');
    expect(formatCustomerLocale('fr', t)).toBe('French');
    expect(formatCustomerLocale('unknown', t)).toBe('Unavailable');
  });

});
