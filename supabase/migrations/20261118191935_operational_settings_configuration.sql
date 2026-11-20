-- ORG-FR-004 / BR-009. Configuration only; existing models, RLS and transaction workers are retained.
-- Local/undeployed. Never apply to hosted production without the separate migration-history approval gate.
create function app_private.validate_business_configuration() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or new.timezone is distinct from old.timezone then
    if new.timezone is not null and (new.timezone<>btrim(new.timezone)
      or (new.timezone<>'UTC' and position('/' in new.timezone)=0)
      or not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone)) then
      raise exception using errcode='22023',message='SETTINGS_TIMEZONE_INVALID';
    end if;
  end if;
  if not length(btrim(new.name)) between 1 and 160 then raise exception using errcode='22023',message='SETTINGS_NAME_INVALID'; end if;
  if tg_table_name='organizations' then
    if tg_op='INSERT' or new.currency_code is distinct from old.currency_code then
      if new.currency_code !~ '^[A-Z]{3}$' then raise exception using errcode='22023',message='SETTINGS_CURRENCY_INVALID'; end if;
      if tg_op='UPDATE' then
        -- The UPDATE's row lock conflicts with the SHARE locks taken by new monetary records.
        if exists(select 1 from public.batches where organization_id=new.id)
          or exists(select 1 from public.purchase_orders where organization_id=new.id)
          or exists(select 1 from public.sales where organization_id=new.id) then
          raise exception using errcode='22023',message='SETTINGS_CURRENCY_LOCKED';
        end if;
      end if;
    end if;
  elsif tg_op='UPDATE' and old.status='active' and new.status='inactive' then
    -- Serialize branch deactivation so an owner cannot lose every operational branch.
    perform 1 from public.organizations where id=new.organization_id for update;
    if not exists(select 1 from public.branches where organization_id=new.organization_id and id<>new.id and status='active') then
      raise exception using errcode='22023',message='SETTINGS_LAST_BRANCH';
    end if;
  end if;
  return new;
end; $$;
revoke all on function app_private.validate_business_configuration() from public,anon,authenticated;
create trigger organizations_validate_configuration before insert or update on public.organizations
for each row execute function app_private.validate_business_configuration();
create trigger branches_validate_configuration before insert or update on public.branches
for each row execute function app_private.validate_business_configuration();

create function app_private.lock_business_currency() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_currency text;
begin
  select currency_code into v_currency from public.organizations where id=new.organization_id for share;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception using errcode='22023',message='SETTINGS_CURRENCY_INVALID'; end if;
  if tg_table_name='sales' then
    if tg_op='INSERT' then new.currency_code:=v_currency; end if;
    if new.currency_code is distinct from v_currency then raise exception using errcode='22023',message='SETTINGS_CURRENCY_MISMATCH'; end if;
  end if;
  return new;
end; $$;
revoke all on function app_private.lock_business_currency() from public,anon,authenticated;
create trigger batches_lock_currency before insert or update of organization_id on public.batches
for each row execute function app_private.lock_business_currency();
create trigger purchase_orders_lock_currency before insert or update of organization_id on public.purchase_orders
for each row execute function app_private.lock_business_currency();
create trigger sales_lock_currency before insert or update of organization_id,currency_code on public.sales
for each row execute function app_private.lock_business_currency();

create or replace function app_private.notify_expiry_alert() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(organization_id,branch_id,recipient_user_id,type,title_key,body_key,payload)
  select new.organization_id,new.branch_id,m.user_id,'EXPIRY_ALERT','expiry.title',
    case when new.alert_type='EXPIRED' then 'expiry.expired' else 'expiry.warning' end,
    jsonb_build_object('alert_id',new.id,'batch_id',new.batch_id,'days',new.threshold_days)
  from public.organization_memberships m join public.roles r on r.id=m.role_id
  join public.role_permissions rp on rp.role_id=r.id and rp.permission_code='inventory.read'
  left join public.notification_preferences pref on pref.organization_id=m.organization_id and pref.user_id=m.user_id
  where m.organization_id=new.organization_id and m.status='active' and coalesce(pref.in_app,true);
  return new;
end; $$;
revoke all on function app_private.notify_expiry_alert() from public,anon,authenticated;
-- Existing trigger is retained. No delivery provider or external channel is added.

-- The existing shared audit trigger assumed every record had organization_id.
-- Organizations use id itself; preserve the existing before/after audit contract.
create or replace function app_private.audit_security_change()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  org_id uuid;
  branch_value uuid;
begin
  if tg_table_name = 'organizations' then
    org_id := coalesce(new.id, old.id);
  else
    org_id := coalesce(new.organization_id, old.organization_id);
  end if;
  if tg_table_name = 'branches' then
    branch_value := coalesce(new.id, old.id);
  else
    branch_value := null;
  end if;

  insert into public.audit_logs(
    organization_id, branch_id, actor_user_id, event_type, entity_type, entity_id, before_data, after_data
  ) values (
    org_id,
    branch_value,
    auth.uid(),
    lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id)::text,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.audit_security_change() from public, anon, authenticated;
