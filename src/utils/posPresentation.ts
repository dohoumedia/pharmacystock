export type PosSaleStatus = 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED';

export function formatPosDate(value: string, language: string, timezone = 'UTC'): string {
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatPosCurrency(amount: number, currencyCode: string, language: string): string {
  if (!currencyCode) return '—';
  return new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-US', {
    ...(currencyCode ? { style: 'currency' as const, currency: currencyCode } : {}),
    maximumFractionDigits: 2,
  }).format(amount);
}

export function posStatusTranslationKey(status: PosSaleStatus): `pos.statuses.${PosSaleStatus}` {
  return `pos.statuses.${status}`;
}
