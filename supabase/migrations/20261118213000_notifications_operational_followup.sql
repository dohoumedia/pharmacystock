-- PRD-008, EXP-FR-003/004: extend the existing in-app inbox only.
-- Local and undeployed. No inventory, financial, or external delivery writes.
alter table public.notifications add column condition_key text;
alter table public.notifications add column resolved_at timestamptz;
alter table public.notifications add column checked_at timestamptz;
create unique index notifications_open_condition on public.notifications(organization_id,recipient_user_id,condition_key)
where condition_key is not null and resolved_at is null;
create index notifications_inbox_page on public.notifications(organization_id,recipient_user_id,created_at desc,id desc);

-- Supersede legacy expiry fanout with the shared application refresh below.
-- Preserve old rows as history; they cannot truthfully claim current status.
drop trigger if exists expiry_alert_notify on public.expiry_alerts;
update public.notifications set resolved_at=now(),read_at=coalesce(read_at,now()) where type='EXPIRY_ALERT';

create function app_private.notification_visible(p_org uuid,p_branch uuid,p_type text)
returns boolean language sql stable security invoker set search_path='' as $$
 select app_private.is_org_member(p_org) and app_private.has_permission(p_org,'notification.read')
 and (p_branch is null or (app_private.has_branch_access(p_branch) and exists(select 1 from public.branches b where b.id=p_branch and b.organization_id=p_org and b.status='active')))
 and case p_type when 'LOW_STOCK' then app_private.has_permission(p_org,'inventory.read')
 when 'OUT_OF_STOCK' then app_private.has_permission(p_org,'inventory.read')
 when 'EXPIRY_ALERT' then app_private.has_permission(p_org,'inventory.read')
 when 'BATCH_ATTENTION' then app_private.has_permission(p_org,'inventory.read')
 when 'PURCHASE_FOLLOWUP' then app_private.has_permission(p_org,'purchase.read')
 when 'TRANSFER_FOLLOWUP' then app_private.has_permission(p_org,'transfer.read')
 when 'COUNT_FOLLOWUP' then app_private.has_permission(p_org,'inventory.count')
 when 'INVITATION_FOLLOWUP' then app_private.has_permission(p_org,'staff.manage')
 when 'IMPORT_FAILED' then app_private.has_permission(p_org,'import.manage')
 else false end
$$;
revoke all on function app_private.notification_visible(uuid,uuid,text) from public,anon;
grant execute on function app_private.notification_visible(uuid,uuid,text) to authenticated;
drop policy notifications_self_read on public.notifications;
create policy notifications_self_read on public.notifications for select to authenticated
using(recipient_user_id=(select auth.uid()) and app_private.notification_visible(organization_id,branch_id,type));
drop policy notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications for update to authenticated
using(recipient_user_id=(select auth.uid()) and app_private.notification_visible(organization_id,branch_id,type))
with check(recipient_user_id=(select auth.uid()) and app_private.notification_visible(organization_id,branch_id,type));

create function app_private.refresh_operational_notifications_impl(p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); conditions jsonb; candidate jsonb;
begin
 if actor is null or not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'notification.read') then
  raise exception using errcode='42501',message='NOTIFICATION_FORBIDDEN';
 end if;
 -- Serialize two tabs for this recipient. The partial unique index also enforces deduplication.
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||actor::text,17));
 with accessible as (
  select b.id,b.name,(now() at time zone coalesce(b.timezone,o.timezone,'UTC'))::date as today from public.branches b join public.organizations o on o.id=b.organization_id where b.organization_id=p_organization_id and b.status='active' and app_private.has_branch_access(b.id)
 ), stock as (
  -- A product without any balance rows is unknown, never invented as zero.
  select b.branch_id,b.product_id,p.name,
   sum(case when b.status='ACTIVE' and b.expiry_date>=a.today then ib.available_quantity else 0 end) qty
  from public.batches b left join public.inventory_balances ib on b.id=ib.batch_id and b.organization_id=ib.organization_id and b.branch_id=ib.branch_id
  join public.products p on p.id=b.product_id join accessible a on a.id=b.branch_id
  where b.organization_id=p_organization_id and p.status='active' and app_private.has_permission(p_organization_id,'inventory.read')
  group by b.branch_id,b.product_id,p.name having not bool_or(ib.batch_id is null)
 ), candidates as (
  select s.branch_id,case when qty=0 then 'OUT_OF_STOCK' else 'LOW_STOCK' end type,
   'stock:'||s.branch_id::text||':'||s.product_id::text||':'||case when qty=0 then 'out' else 'low' end key,
   jsonb_build_object('product_id',s.product_id,'reference',s.name,'quantity',s.qty) payload
  from stock s where qty<=coalesce((select low_stock_default_threshold from public.organization_settings where organization_id=p_organization_id),5)
  union all
  select b.branch_id,'EXPIRY_ALERT','expiry:'||b.id::text,
   jsonb_build_object('batch_id',b.id,'reference',p.name||' · '||b.lot_number,'days',b.expiry_date-a.today,'expiry_date',b.expiry_date)
  from public.batches b join accessible a on a.id=b.branch_id join public.products p on p.id=b.product_id
  join public.inventory_balances ib on ib.batch_id=b.id and ib.organization_id=b.organization_id and ib.branch_id=b.branch_id
  where b.organization_id=p_organization_id and ib.on_hand_quantity>0 and b.status in ('ACTIVE','EXPIRED','QUARANTINED','RECALLED')
   and app_private.has_permission(p_organization_id,'inventory.read')
   and (b.expiry_date<a.today or exists(select 1 from unnest(coalesce((select thresholds_days from public.expiry_policies where organization_id=p_organization_id),array[180,90,60,30,7])) d where b.expiry_date-a.today<=d))
  union all
  select b.branch_id,'BATCH_ATTENTION','batch:'||b.id::text,
   jsonb_build_object('batch_id',b.id,'reference',p.name||' · '||b.lot_number,'status',b.status)
  from public.batches b join accessible a on a.id=b.branch_id join public.products p on p.id=b.product_id
  join public.inventory_balances ib on ib.batch_id=b.id and ib.organization_id=b.organization_id and ib.branch_id=b.branch_id
  where b.organization_id=p_organization_id and ib.on_hand_quantity>0 and b.status in ('QUARANTINED','RECALLED') and app_private.has_permission(p_organization_id,'inventory.read')
  union all
  select po.branch_id,'PURCHASE_FOLLOWUP','purchase:'||po.id::text,
   jsonb_build_object('order_id',po.id,'reference',po.po_number,'status',po.status)
  from public.purchase_orders po join accessible a on a.id=po.branch_id
  where po.organization_id=p_organization_id and po.status in ('ordered','partially_received') and app_private.has_permission(p_organization_id,'purchase.read')
  union all
  select a.id,'TRANSFER_FOLLOWUP','transfer:'||st.id::text||':'||st.status,
   jsonb_build_object('transfer_id',st.id,'reference',st.transfer_number,'status',st.status)
  from public.stock_transfers st join accessible a on a.id=case when st.status='DISPATCHED' then st.destination_branch_id
   when st.status='REQUESTED' and not exists(select 1 from accessible x where x.id=st.source_branch_id) then st.destination_branch_id else st.source_branch_id end
  where st.organization_id=p_organization_id and app_private.has_permission(p_organization_id,'transfer.read') and
   ((st.status='REQUESTED' and app_private.has_permission(p_organization_id,'transfer.approve')) or
    (st.status='APPROVED' and app_private.has_permission(p_organization_id,'transfer.dispatch')) or
    (st.status='DISPATCHED' and app_private.has_permission(p_organization_id,'transfer.receive')))
  union all
  select c.branch_id,'COUNT_FOLLOWUP','count:'||c.id::text,
   jsonb_build_object('count_id',c.id,'reference',c.id::text)
  from public.inventory_stock_counts c join accessible a on a.id=c.branch_id
  where c.organization_id=p_organization_id and c.status='OPEN' and app_private.has_permission(p_organization_id,'inventory.count')
  union all
  select i.branch_id,'INVITATION_FOLLOWUP','invitation:'||i.id::text,
   jsonb_build_object('invitation_id',i.id,'reference',i.display_name,'expired',i.expires_at<=now())
  from public.staff_invitations i join accessible a on a.id=i.branch_id
  where i.organization_id=p_organization_id and i.status='pending' and app_private.has_permission(p_organization_id,'staff.manage')
  union all
  select j.branch_id,'IMPORT_FAILED','import:'||j.id::text,
   jsonb_build_object('import_id',j.id,'reference',coalesce(j.file_name,j.id::text))
  from public.import_jobs j where j.organization_id=p_organization_id and j.status='FAILED'
   and app_private.has_permission(p_organization_id,'import.manage') and (j.branch_id is null or exists(select 1 from accessible a where a.id=j.branch_id))
 )
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('branch_name',a.name)),'[]'::jsonb) into conditions
 from candidates c left join accessible a on a.id=c.branch_id
 where coalesce((select in_app from public.notification_preferences where organization_id=p_organization_id and user_id=actor),true)
 and coalesce((select (notification_channels->>'in_app')::boolean from public.organization_settings where organization_id=p_organization_id),true);

 update public.notifications n set resolved_at=now(),read_at=coalesce(n.read_at,now()),checked_at=now()
 where n.organization_id=p_organization_id and n.recipient_user_id=actor and n.condition_key is not null and n.resolved_at is null
 and not exists(select 1 from jsonb_array_elements(conditions) c where c->>'key'=n.condition_key);
 for candidate in select * from jsonb_array_elements(conditions) loop
  insert into public.notifications(organization_id,branch_id,recipient_user_id,type,title_key,body_key,payload,condition_key,checked_at)
  values(p_organization_id,(candidate->>'branch_id')::uuid,actor,candidate->>'type',
   'notificationsReady.events.'||(candidate->>'type')||'.title','notificationsReady.events.'||(candidate->>'type')||'.body',
   (candidate->'payload')||jsonb_build_object('branch_name',candidate->>'branch_name'),candidate->>'key',now())
  on conflict(organization_id,recipient_user_id,condition_key) where condition_key is not null and resolved_at is null
  do update set branch_id=excluded.branch_id,payload=excluded.payload,checked_at=excluded.checked_at;
 end loop;
end $$;
revoke all on function app_private.refresh_operational_notifications_impl(uuid) from public,anon;
grant execute on function app_private.refresh_operational_notifications_impl(uuid) to authenticated;
create function public.refresh_operational_notifications(p_organization_id uuid)
returns void language sql security invoker set search_path='' as $$
 select app_private.refresh_operational_notifications_impl(p_organization_id)
$$;
revoke all on function public.refresh_operational_notifications(uuid) from public,anon;
grant execute on function public.refresh_operational_notifications(uuid) to authenticated;
