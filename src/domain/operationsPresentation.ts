export type ReportsLayout = 'mobile' | 'desktop';

export function reportsLayoutForWidth(width: number): ReportsLayout {
  return width >= 768 ? 'desktop' : 'mobile';
}

export function isSettingsReadStale(syncedAt: string | null, now = Date.now(), maxAgeMs = 15 * 60 * 1000): boolean {
  if (!syncedAt) return true;
  const timestamp = Date.parse(syncedAt);
  return !Number.isFinite(timestamp) || now - timestamp > maxAgeMs;
}

export function formatReportMoney(value: number | null, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value ?? 0);
}

export function formatReportDate(value: string | null, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}
