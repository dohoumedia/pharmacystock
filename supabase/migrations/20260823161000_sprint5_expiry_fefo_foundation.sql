insert into public.permissions(code,description_en,description_fr) values
('inventory.expiry.manage','Manage expiry alerts and expiry actions','Gérer les alertes et actions de péremption')
on conflict(code) do update set description_en=excluded.description_en,description_fr=excluded.description_fr;

insert into public.role_permissions(role_id,permission_code)
select r.id,'inventory.expiry.manage' from public.roles r
where r.organization_id is null and r.code in ('OWNER','MANAGER','INVENTORY_OFFICER')
on conflict do nothing;

create table public.expiry_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  thresholds_days integer[] not null default array[180,90,60,30,7],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expiry_policies_thresholds_valid check (cardinality(thresholds_days) between 1 and 10 and 0 < all(thresholds_days))
);

create table public.expiry_alerts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null, batch_id uuid not null,
  alert_type text not null check(alert_type in ('EXPIRY_WARNING','EXPIRED')),
  threshold_days integer not null default 0 check(threshold_days>=0), expiry_date_snapshot date not null,
  status text not null default 'OPEN' check(status in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  acknowledged_by uuid references auth.users(id) on delete set null, acknowledged_at timestamptz,
  created_at timestamptz not null default now(), resolved_at timestamptz,
  unique(organization_id,batch_id,alert_type,threshold_days,expiry_date_snapshot),
  foreign key(organization_id,branch_id) references public.branches(organization_id,id) on delete restrict,
  foreign key(organization_id,batch_id) references public.batches(organization_id,id) on delete cascade
);

create table public.expiry_actions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null, batch_id uuid not null,
  action_type text not null check(action_type in ('PRIORITIZE_SALE','QUARANTINE','RELEASE_QUARANTINE','DISPOSE','SUPPLIER_RETURN')),
  quantity numeric(18,4), reason text, actor_user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  foreign key(organization_id,branch_id) references public.branches(organization_id,id) on delete restrict,
  foreign key(organization_id,batch_id) references public.batches(organization_id,id) on delete restrict
);

create trigger expiry_policies_set_updated_at before update on public.expiry_policies for each row execute function public.set_updated_at();
create index expiry_alerts_org_branch_status_idx on public.expiry_alerts(organization_id,branch_id,status,created_at desc);
create index expiry_alerts_batch_idx on public.expiry_alerts(organization_id,batch_id);
create index expiry_actions_batch_idx on public.expiry_actions(organization_id,batch_id,created_at desc);

alter table public.expiry_policies enable row level security;
alter table public.expiry_alerts enable row level security;
alter table public.expiry_actions enable row level security;
create policy expiry_policies_read on public.expiry_policies for select to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'inventory.read'));
create policy expiry_policies_manage on public.expiry_policies for all to authenticated using(app_private.has_permission(organization_id,'inventory.expiry.manage')) with check(app_private.has_permission(organization_id,'inventory.expiry.manage'));
create policy expiry_alerts_read on public.expiry_alerts for select to authenticated using(app_private.has_permission(organization_id,'inventory.read') and app_private.has_branch_access(branch_id));
create policy expiry_actions_read on public.expiry_actions for select to authenticated using(app_private.has_permission(organization_id,'inventory.read') and app_private.has_branch_access(branch_id));
grant select,insert,update on public.expiry_policies to authenticated;
grant select on public.expiry_alerts,public.expiry_actions to authenticated;

create or replace view public.expiry_risk with (security_invoker=true) as
select b.organization_id,b.branch_id,b.id as batch_id,b.product_id,p.name as product_name,p.generic_name,b.lot_number,b.expiry_date,
  (b.expiry_date-current_date)::integer as days_remaining,b.status as batch_status,
  coalesce(ib.on_hand_quantity,0)::numeric(18,4) as on_hand_quantity,b.purchase_cost,
  (coalesce(ib.on_hand_quantity,0)*coalesce(b.purchase_cost,0))::numeric(18,2) as value_at_risk,
  case when b.expiry_date<current_date then 'EXPIRED' when b.expiry_date-current_date<=7 then '7_DAYS'
    when b.expiry_date-current_date<=30 then '30_DAYS' when b.expiry_date-current_date<=60 then '60_DAYS'
    when b.expiry_date-current_date<=90 then '90_DAYS' when b.expiry_date-current_date<=180 then '180_DAYS' else 'OK' end as risk_bucket
from public.batches b join public.products p on p.id=b.product_id and p.organization_id=b.organization_id
left join public.inventory_balances ib on ib.organization_id=b.organization_id and ib.branch_id=b.branch_id and ib.batch_id=b.id
where coalesce(ib.on_hand_quantity,0)>0 and b.status not in ('DISPOSED','DEPLETED');
grant select on public.expiry_risk to authenticated;

create or replace function public.get_fefo_batches(p_organization_id uuid,p_branch_id uuid,p_product_id uuid)
returns table(batch_id uuid,lot_number text,expiry_date date,available_quantity numeric,days_remaining integer)
language plpgsql stable security invoker set search_path=public,app_private,pg_temp as $$
begin
  if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'inventory.read') then raise exception using errcode='42501',message='INVENTORY_READ_FORBIDDEN'; end if;
  if not app_private.has_branch_access(p_branch_id) then raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED'; end if;
  return query select b.id,b.lot_number,b.expiry_date,ib.available_quantity,(b.expiry_date-current_date)::integer
  from public.batches b join public.inventory_balances ib on ib.organization_id=b.organization_id and ib.branch_id=b.branch_id and ib.batch_id=b.id
  where b.organization_id=p_organization_id and b.branch_id=p_branch_id and b.product_id=p_product_id and b.status='ACTIVE' and b.expiry_date>=current_date and ib.available_quantity>0
  order by b.expiry_date asc,b.created_at asc;
end; $$;
revoke all on function public.get_fefo_batches(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_fefo_batches(uuid,uuid,uuid) to authenticated;

create or replace function app_private.refresh_expiry_alerts_impl(p_organization_id uuid,p_branch_id uuid default null)
returns integer language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_inserted integer:=0;
begin
  insert into public.expiry_policies(organization_id) values(p_organization_id) on conflict do nothing;
  update public.batches b set status='EXPIRED' where b.organization_id=p_organization_id and (p_branch_id is null or b.branch_id=p_branch_id) and b.expiry_date<current_date and b.status in ('ACTIVE','QUARANTINED');
  with policy as (select thresholds_days from public.expiry_policies where organization_id=p_organization_id), candidates as (
    select er.*,case when er.days_remaining<0 then 0 else (select min(t) from policy,unnest(policy.thresholds_days)t where t>=er.days_remaining) end as matched_threshold
    from public.expiry_risk er where er.organization_id=p_organization_id and (p_branch_id is null or er.branch_id=p_branch_id)
  )
  insert into public.expiry_alerts(organization_id,branch_id,batch_id,alert_type,threshold_days,expiry_date_snapshot)
  select organization_id,branch_id,batch_id,case when days_remaining<0 then 'EXPIRED' else 'EXPIRY_WARNING' end,matched_threshold,expiry_date
  from candidates where days_remaining<0 or matched_threshold is not null on conflict do nothing;
  get diagnostics v_inserted=row_count;
  update public.expiry_alerts ea set status='RESOLVED',resolved_at=coalesce(resolved_at,now())
  where ea.organization_id=p_organization_id and (p_branch_id is null or ea.branch_id=p_branch_id) and ea.status<>'RESOLVED'
    and not exists(select 1 from public.expiry_risk er where er.organization_id=ea.organization_id and er.batch_id=ea.batch_id);
  return v_inserted;
end; $$;

create or replace function public.refresh_expiry_alerts(p_organization_id uuid,p_branch_id uuid default null)
returns integer language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
begin
  if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'inventory.read') then raise exception using errcode='42501',message='INVENTORY_READ_FORBIDDEN'; end if;
  if p_branch_id is not null and not app_private.has_branch_access(p_branch_id) then raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED'; end if;
  return app_private.refresh_expiry_alerts_impl(p_organization_id,p_branch_id);
end; $$;
revoke all on function app_private.refresh_expiry_alerts_impl(uuid,uuid) from public,anon;
grant execute on function app_private.refresh_expiry_alerts_impl(uuid,uuid) to authenticated;
revoke all on function public.refresh_expiry_alerts(uuid,uuid) from public,anon;
grant execute on function public.refresh_expiry_alerts(uuid,uuid) to authenticated;
