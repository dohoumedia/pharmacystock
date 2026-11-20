import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { NOTIFICATION_PAGE_SIZE, notificationPage, type OperationalNotification } from '../domain/notificationFollowup';
type InboxDatabase = { public: { Tables: { notifications: { Row: OperationalNotification; Insert: never; Update: { read_at: string | null }; Relationships: [] } }; Views: Record<string, never>; Functions: { refresh_operational_notifications: { Args: { p_organization_id: string }; Returns: undefined } }; Enums: Record<string, never>; CompositeTypes: Record<string, never> } };
const db = supabase as unknown as SupabaseClient<InboxDatabase>;
export async function refreshNotificationConditions(organizationId: string) {
  const { error } = await db.rpc('refresh_operational_notifications', { p_organization_id: organizationId });
  if (error) throw error;
}
export async function notificationList(organizationId: string, userId: string, unread: boolean, page = 0) {
  if (!Number.isInteger(page) || page < 0) throw new Error('NOTIFICATION_PAGE_INVALID');
  let query = db.from('notifications').select('*').eq('organization_id', organizationId).eq('recipient_user_id', userId);
  if (unread) query = query.is('read_at', null).is('resolved_at', null);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * NOTIFICATION_PAGE_SIZE, (page + 1) * NOTIFICATION_PAGE_SIZE);
  if (error) throw error;
  return notificationPage(data);
}
export async function notificationUnreadCount(organizationId: string, userId: string) {
  const { count, error } = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('recipient_user_id', userId).is('read_at', null).is('resolved_at', null);
  if (error) throw error;
  return count ?? 0;
}
export async function setNotificationRead(organizationId: string, userId: string, id: string, read: boolean) {
  const { error } = await db.from('notifications').update({ read_at: read ? new Date().toISOString() : null }).eq('organization_id', organizationId).eq('recipient_user_id', userId).eq('id', id).is('resolved_at', null).select('id').single();
  if (error) throw error;
}
export async function markAllNotificationsRead(organizationId: string, userId: string) {
  const { error } = await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('recipient_user_id', userId).is('read_at', null).is('resolved_at', null);
  if (error) throw error;
}
