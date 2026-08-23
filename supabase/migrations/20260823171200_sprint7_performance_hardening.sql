create index if not exists customers_created_by_idx on public.customers(created_by);
create index if not exists import_jobs_created_by_idx on public.import_jobs(created_by);
create index if not exists import_jobs_org_branch_idx on public.import_jobs(organization_id,branch_id) where branch_id is not null;
create index if not exists import_rows_org_idx on public.import_rows(organization_id);
create index if not exists notification_preferences_user_idx on public.notification_preferences(user_id);
create index if not exists notifications_org_branch_idx on public.notifications(organization_id,branch_id) where branch_id is not null;
create index if not exists notifications_org_idx on public.notifications(organization_id);
create index if not exists organization_settings_updated_by_idx on public.organization_settings(updated_by) where updated_by is not null;
create index if not exists subscriptions_plan_code_idx on public.subscriptions(plan_code);

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated with check(created_by=(select auth.uid()) and app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'customer.manage'));

drop policy if exists notification_preferences_self on public.notification_preferences;
create policy notification_preferences_self on public.notification_preferences for all to authenticated using(user_id=(select auth.uid()) and app_private.is_org_member(organization_id)) with check(user_id=(select auth.uid()) and app_private.is_org_member(organization_id));

drop policy if exists notifications_self_read on public.notifications;
create policy notifications_self_read on public.notifications for select to authenticated using(recipient_user_id=(select auth.uid()) and app_private.is_org_member(organization_id));
drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications for update to authenticated using(recipient_user_id=(select auth.uid())) with check(recipient_user_id=(select auth.uid()));

drop policy if exists import_jobs_insert on public.import_jobs;
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check(created_by=(select auth.uid()) and app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage'));
