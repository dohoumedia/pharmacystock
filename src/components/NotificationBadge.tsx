import { Link } from 'expo-router';
import { useTranslation } from '../i18n/useTranslation';
import { useNotifications } from '../providers/NotificationProvider';
import { useOrganization } from '../providers/OrganizationProvider';
import { Button } from './ui';
export function NotificationBadge() {
  const { t } = useTranslation(); const { count, cached, error, syncedAt } = useNotifications(); const { can } = useOrganization();
  if (!can('notification.read')) return null;
  return <Link href="/notifications" asChild><Button variant="secondary" label={t('notificationsReady.badge', { count: syncedAt ? (count > 99 ? '99+' : count) : '—' }) + (cached || error ? ` · ${t('notificationsReady.cachedBadge')}` : '')} /></Link>;
}
