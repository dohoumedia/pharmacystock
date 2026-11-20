-- Transfer-only read context. Do not broaden underlying branch/batch/profile RLS.
create or replace function public.read_stock_transfer_context(p_transfer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_t public.stock_transfers%rowtype; v_manage boolean;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 v_manage:=app_private.has_permission(v_t.organization_id,'branch.manage');
 if auth.uid() is null or not app_private.is_org_member(v_t.organization_id)
    or not app_private.has_permission(v_t.organization_id,'transfer.read')
    or not (app_private.has_branch_access(v_t.source_branch_id) or app_private.has_branch_access(v_t.destination_branch_id) or v_manage) then
   raise exception using errcode='42501',message='TRANSFER_READ_FORBIDDEN';
 end if;
 return jsonb_build_object(
  'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'status',b.status)),'[]'::jsonb) from public.branches b where b.organization_id=v_t.organization_id and b.id in(v_t.source_branch_id,v_t.destination_branch_id)),
  'batches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'organization_id',b.organization_id,'branch_id',b.branch_id,'product_id',b.product_id,'lot_number',b.lot_number,'expiry_date',b.expiry_date,'status',b.status)),'[]'::jsonb) from public.batches b where b.organization_id=v_t.organization_id and exists(select 1 from public.stock_transfer_lines l where l.organization_id=v_t.organization_id and l.transfer_id=v_t.id and b.id in(l.source_batch_id,l.destination_batch_id))),
  'profiles',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'display_name',p.display_name)),'[]'::jsonb) from public.profiles p where p.user_id in(v_t.requested_by,v_t.approved_by,v_t.dispatched_by,v_t.received_by)),
  'balances',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from public.inventory_balances i where i.organization_id=v_t.organization_id
    and (v_manage or app_private.has_branch_access(i.branch_id) or (i.branch_id=v_t.source_branch_id and (app_private.has_permission(v_t.organization_id,'transfer.approve') or app_private.has_permission(v_t.organization_id,'transfer.dispatch'))))
    and exists(select 1 from public.stock_transfer_lines l where l.organization_id=v_t.organization_id and l.transfer_id=v_t.id and i.batch_id in(l.source_batch_id,l.destination_batch_id))),
  'movements',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'branch_id',m.branch_id,'batch_id',m.batch_id,'quantity_delta',m.quantity_delta,'reference_id',m.reference_id,'occurred_at',m.occurred_at)),'[]'::jsonb) from public.inventory_movements m where m.organization_id=v_t.organization_id and m.reference_type='STOCK_TRANSFER' and m.reference_id=v_t.id::text and exists(select 1 from public.stock_transfer_lines l where l.organization_id=v_t.organization_id and l.transfer_id=v_t.id and m.id in(l.transfer_out_movement_id,l.transfer_in_movement_id))),
  'history',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'event_type',a.event_type,'created_at',a.created_at) order by a.created_at,a.id),'[]'::jsonb) from public.audit_logs a where a.organization_id=v_t.organization_id and a.entity_type='stock_transfer' and a.entity_id=v_t.id::text)
 );
end $$;

create or replace function public.list_stock_transfer_destinations(p_organization_id uuid,p_source_branch_id uuid)
returns table(id uuid,name text,status text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.is_org_member(p_organization_id)
    or not app_private.has_permission(p_organization_id,'transfer.create')
    or not (app_private.has_branch_access(p_source_branch_id) or app_private.has_permission(p_organization_id,'branch.manage'))
    or not exists(select 1 from public.branches b where b.id=p_source_branch_id and b.organization_id=p_organization_id and b.status='active') then
   raise exception using errcode='42501',message='TRANSFER_CREATE_FORBIDDEN';
 end if;
 return query select b.id,b.name,b.status from public.branches b where b.organization_id=p_organization_id and b.status='active' and b.id<>p_source_branch_id order by b.name,b.id;
end $$;
revoke all on function public.read_stock_transfer_context(uuid),public.list_stock_transfer_destinations(uuid,uuid) from public,anon;
grant execute on function public.read_stock_transfer_context(uuid),public.list_stock_transfer_destinations(uuid,uuid) to authenticated;
