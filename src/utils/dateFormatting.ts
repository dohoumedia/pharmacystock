const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Formats a SQL DATE without interpreting the calendar value as an instant. */
export function formatDateOnly(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/** Formats a timestamp/timestamptz as the user's local calendar date. */
export function formatInstantDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

/** Formats a timestamp/timestamptz as a localized date and time. */
export function formatInstantDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
