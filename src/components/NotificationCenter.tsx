import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from '../i18n/useTranslation';
import { useNotifications } from '../providers/NotificationProvider';
import { useOrganization } from '../providers/OrganizationProvider';
import { notificationDestination, notificationPayload, NOTIFICATION_REFRESH_MS, type OperationalNotification } from '../domain/notificationFollowup';
import { formatInstantDateTime } from '../utils/dateFormatting';
import { effectiveTimezone } from '../domain/businessSettings';
import { Alert, Button, StatusBadge, Surface } from './ui';
import { ReadModelStatus } from './ReadModelStatus';
export function NotificationRow({ row, disabled, onRead, onOpen }: { row: OperationalNotification; disabled: boolean; onRead: () => void; onOpen?: () => void }) {
  const { t, i18n } = useTranslation(); const { organization, branches } = useOrganization();
  const p = notificationPayload(row);
  const reference = typeof p.reference === 'string' ? p.reference : row.id;
  return <Surface style={{ gap: 10 }}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    <StatusBadge label={t(row.resolved_at ? 'notificationsReady.resolved' : row.read_at ? 'notificationsReady.read' : 'notificationsReady.unread')} />
    <Text>{t(`notificationsReady.events.${row.type}.category`)}</Text></View>
    <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 18 }}>{t(`notificationsReady.events.${row.type}.title`)}</Text>
    <Text>{t(`notificationsReady.events.${row.type}.body`)}</Text><Text selectable>{reference}</Text>
    {typeof p.quantity === 'number' ? <Text>{t('notificationsReady.quantity', { quantity: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(p.quantity) })}</Text> : null}
    {row.condition_key && typeof p.days === 'number' ? <Text>{t(p.days < 0 ? 'notificationsReady.expiredDays' : 'notificationsReady.remainingDays', { count: Math.abs(p.days) })}</Text> : null}
    {typeof p.status === 'string' ? <Text>{t(`notificationsReady.status.${p.status}`)}</Text> : null}
    {p.expired === true ? <Text>{t('notificationsReady.invitationExpired')}</Text> : null}
    <Text>{row.branch_id ? (typeof p.branch_name === 'string' ? p.branch_name : row.branch_id) : t('notificationsReady.organizationWide')}</Text>
    <Text>{formatInstantDateTime(row.created_at, i18n.language, effectiveTimezone(organization?.timezone, branches.find(b => b.id === row.branch_id)?.timezone))}</Text>
    {row.resolved_at ? <Text>{t('notificationsReady.closedAt', { date: formatInstantDateTime(row.resolved_at, i18n.language, effectiveTimezone(organization?.timezone, branches.find(b => b.id === row.branch_id)?.timezone)) })}</Text> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {onOpen ? <Button disabled={disabled} label={t('notificationsReady.open')} onPress={onOpen} /> : null}
      <Button disabled={disabled} variant="secondary" label={t(row.read_at ? 'notificationsReady.markUnread' : 'notificationsReady.markRead')} onPress={onRead} />
    </View>}</Surface>;
}
export function NotificationCenter() {
  const { t } = useTranslation(); const inbox = useNotifications();
  const { can, branch, branches, setBranchId } = useOrganization();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(timer); }, []);
  const stale = !inbox.syncedAt || now - Date.parse(inbox.syncedAt) > NOTIFICATION_REFRESH_MS;
  if (!can('notification.read')) return <Alert tone="warning" title={t('notificationsReady.noAccess')} />;
  const open = async (row: OperationalNotification) => {
    const destination = notificationDestination(row, can);
    if (!destination || !inbox.writable || (row.branch_id && !branches.some(b => b.id === row.branch_id))) return;
    // Mark only this row. A failed mark keeps the inbox retryable and visible.
    if (!row.read_at && !await inbox.read(row.id, true)) return;
    if (row.branch_id && row.branch_id !== branch?.id) setBranchId(row.branch_id);
    router.push(destination as '/');
  };
  return <View style={{ gap: 16 }}>
    <ReadModelStatus loading={inbox.loading} usingCachedData={inbox.cached} stale={stale} syncedAt={inbox.syncedAt} hasData={Boolean(inbox.syncedAt)} />
    <Text>{t('notificationsReady.timing')}</Text><Text>{t('settingsReady.deliveryUnavailable')}</Text>
    {!inbox.enabled ? <Alert tone="info" title={t('notificationsReady.disabled')} /> : null}
    {!inbox.writable ? <Alert tone="warning" title={t('notificationsReady.onlineRequired')} /> : null}
    {inbox.error ? <Alert tone="danger" title={t('notificationsReady.failed')} /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button variant={!inbox.unread ? 'primary' : 'secondary'} label={t('notificationsReady.all')} onPress={() => inbox.setUnread(false)} />
      <Button variant={inbox.unread ? 'primary' : 'secondary'} label={t('notificationsReady.unreadFilter')} onPress={() => inbox.setUnread(true)} />
      <Button variant="secondary" disabled={!inbox.writable || inbox.busy || inbox.loading || !inbox.count} label={t('notificationsReady.markAll')} onPress={() => void inbox.readAll()} />
      <Button variant="ghost" disabled={!inbox.writable || inbox.loading || inbox.busy} label={t('notificationsReady.refresh')} onPress={() => void inbox.refresh()} />
    </View>
    <Text accessibilityLiveRegion="polite">{inbox.syncedAt ? t('notificationsReady.unreadCount', { count: inbox.count }) : t('notificationsReady.unreadUnknown')}</Text>
    {!inbox.items.length && !inbox.loading ? <Text>{t(!inbox.syncedAt ? 'notificationsReady.notLoaded' : inbox.unread ? 'notificationsReady.emptyUnread' : 'notificationsReady.empty')}</Text> : null}
    {inbox.items.map(row => <NotificationRow key={row.id} row={row} disabled={!inbox.writable || inbox.busy || inbox.loading || inbox.cached} onRead={() => void inbox.read(row.id, !row.read_at)} onOpen={notificationDestination(row, can) ? () => void open(row) : undefined} />)}
    {inbox.hasMore ? <Button disabled={!inbox.writable || inbox.loading || inbox.busy} label={t('notificationsReady.more')} onPress={() => void inbox.more()} /> : null}
  </View>;
}
