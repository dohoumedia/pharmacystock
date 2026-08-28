import { formatDateOnly, formatInstantDateTime } from '../utils/dateFormatting';

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
  return formatCurrency(value, locale, currency);
}

export function formatReportDate(value: string | null, locale: string): string {
  return formatDateOnly(value, locale);
}

export function formatCurrency(value: number | null | undefined, locale: string, currency: string | null | undefined): string {
  const amount = value ?? 0;
  const code = currency?.trim().toUpperCase();
  if (!code) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)} ${code}`;
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const importTypeKeys: Record<string, string> = {
  PRODUCTS: 'production.operations.importType.products',
  SUPPLIERS: 'production.operations.importType.suppliers',
  CUSTOMERS: 'production.operations.importType.customers',
  OPENING_STOCK: 'production.operations.importType.openingStock',
};

const importStatusKeys: Record<string, string> = {
  DRAFT: 'production.operations.importStatus.draft',
  VALIDATING: 'production.operations.importStatus.validating',
  READY: 'production.operations.importStatus.ready',
  COMMITTING: 'production.operations.importStatus.committing',
  COMPLETED: 'production.operations.importStatus.completed',
  FAILED: 'production.operations.importStatus.failed',
  CANCELLED: 'production.operations.importStatus.cancelled',
};

const subscriptionStatusKeys: Record<string, string> = {
  NOT_ACTIVATED: 'production.operations.subscriptionStatus.notActivated',
  TRIAL: 'production.operations.subscriptionStatus.trial',
  ACTIVE: 'production.operations.subscriptionStatus.active',
  PAST_DUE: 'production.operations.subscriptionStatus.pastDue',
  GRACE: 'production.operations.subscriptionStatus.grace',
  SUSPENDED: 'production.operations.subscriptionStatus.suspended',
  CANCELLED: 'production.operations.subscriptionStatus.cancelled',
};

const auditEntityKeys: Record<string, string> = {
  categories: 'production.operations.auditEntity.category', manufacturers: 'production.operations.auditEntity.manufacturer',
  products: 'production.operations.auditEntity.product', batches: 'production.operations.auditEntity.batch',
  organizations: 'production.operations.auditEntity.organization', branches: 'production.operations.auditEntity.branch',
  organization_memberships: 'production.operations.auditEntity.membership', memberships: 'production.operations.auditEntity.membership',
  customers: 'production.operations.auditEntity.customer', organization_settings: 'production.operations.auditEntity.settings',
  import_jobs: 'production.operations.auditEntity.importJob', purchase_order: 'production.operations.auditEntity.purchaseOrder',
  purchase_receipt: 'production.operations.auditEntity.purchaseReceipt',
};

const auditActionKeys: Record<string, string> = {
  insert: 'production.operations.auditAction.created', update: 'production.operations.auditAction.updated',
  delete: 'production.operations.auditAction.deleted', created: 'production.operations.auditAction.created',
  received: 'production.operations.auditAction.received',
};

const notificationKeys: Record<string, string> = {
  'expiry.title': 'expiry.title',
  'expiry.expired': 'expiry.expired',
  'expiry.warning': 'expiry.warning',
};

const channelKeys: Record<string, string> = {
  email: 'production.operations.channel.email',
  sms: 'production.operations.channel.sms',
  whatsapp: 'production.operations.channel.whatsapp',
  push: 'production.operations.channel.push',
};

const customerLocaleKeys: Record<string, string> = {
  en: 'production.operations.customerLocale.english',
  fr: 'production.operations.customerLocale.french',
};

function labelFor(code: string | null | undefined, labels: Record<string, string>, t: Translate, fallback: string): string {
  const key = labels[code ?? ''];
  return key ? t(key) : t(fallback);
}

export function formatImportType(code: string, t: Translate): string {
  return labelFor(code, importTypeKeys, t, 'production.operations.unknownImportType');
}

export function formatImportStatus(code: string, t: Translate): string {
  return labelFor(code, importStatusKeys, t, 'production.operations.unknownStatus');
}

export function formatSubscriptionStatus(code: string | null | undefined, t: Translate): string {
  return labelFor(code, subscriptionStatusKeys, t, 'production.operations.unknownStatus');
}

export function formatAuditEvent(eventType: string, entityType: string | null, t: Translate): string {
  const [eventEntity, action] = eventType.split('.', 2);
  const entity = entityType?.toLowerCase() || eventEntity;
  const entityLabel = labelFor(entity, auditEntityKeys, t, 'production.operations.auditEntity.record');
  const actionLabel = labelFor(action ?? null, auditActionKeys, t, 'production.operations.auditAction.changed');
  return t('production.operations.auditEvent', { entity: entityLabel, action: actionLabel });
}

export function formatOperationsDate(value: string | null | undefined, locale: string): string {
  return formatInstantDateTime(value, locale);
}

function notificationOptions(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const days = (payload as Record<string, unknown>).days;
  return typeof days === 'number' ? { days } : {};
}

/** Notification keys are server codes. Only explicitly supported keys may reach i18n. */
export function formatNotificationText(key: string, payload: unknown, t: Translate): string {
  const translationKey = notificationKeys[key];
  return translationKey ? t(translationKey, notificationOptions(payload)) : t('production.operations.notificationUnavailable');
}

export function formatNotificationChannel(code: string, t: Translate): string {
  return labelFor(code, channelKeys, t, 'production.operations.channel.unavailable');
}

export function formatCustomerLocale(code: string | null | undefined, t: Translate): string {
  return labelFor(code?.toLowerCase(), customerLocaleKeys, t, 'production.operations.customerLocale.unavailable');
}
