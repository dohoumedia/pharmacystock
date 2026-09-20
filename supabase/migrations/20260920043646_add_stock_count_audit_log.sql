-- Record completed physical stock counts in the append-oriented audit log.
create or replace function public.complete_inventory_stock_count(p_stock_count_id uuid)
returns uuid
language plpgsql
set search_path=public,app_private,pg_temp
as $$
declare
  v_count public.inventory_stock_counts%rowtype;
  v_line record;
  v_current numeric(18,4);
  v_delta numeric(18,4);
  v_line_count integer:=0;
  v_total_expected numeric(18,4):=0;
  v_total_counted numeric(18,4):=0;
  v_total_delta numeric(18,4):=0;
begin
  select * into v_count from public.inventory_stock_counts where id=p_stock_count_id for update;
  if not found then raise exception using errcode='P0002', message='STOCK_COUNT_NOT_FOUND'; end if;
  if v_count.status <> 'OPEN' then raise exception using errcode='23514', message='STOCK_COUNT_NOT_OPEN'; end if;
  if not app_private.has_permission(v_count.organization_id,'inventory.count') then
    raise exception using errcode='42501', message='INSUFFICIENT_PERMISSION';
  end if;
  if not app_private.has_branch_access(v_count.branch_id) then
    raise exception using errcode='42501', message='BRANCH_ACCESS_DENIED';
  end if;

  for v_line in
    select * from public.inventory_stock_count_lines where stock_count_id=p_stock_count_id order by id
  loop
    perform pg_advisory_xact_lock(app_private.inventory_lock_key(v_line.organization_id,v_line.branch_id,v_line.batch_id));
    select coalesce(sum(quantity_delta),0)::numeric(18,4) into v_current
    from public.inventory_movements
    where organization_id=v_line.organization_id and branch_id=v_line.branch_id and batch_id=v_line.batch_id;

    v_delta := v_line.counted_quantity - v_current;
    update public.inventory_stock_count_lines set expected_quantity=v_current, updated_at=now() where id=v_line.id;

    v_line_count:=v_line_count+1;
    v_total_expected:=v_total_expected+v_current;
    v_total_counted:=v_total_counted+v_line.counted_quantity;
    v_total_delta:=v_total_delta+v_delta;

    if v_delta <> 0 then
      perform public.post_inventory_movement(
        v_line.organization_id,
        v_line.branch_id,
        v_line.batch_id,
        case when v_delta > 0 then 'COUNT_CORRECTION_IN' else 'COUNT_CORRECTION_OUT' end,
        v_delta,
        'stock-count:' || p_stock_count_id::text || ':batch:' || v_line.batch_id::text,
        'Physical stock count reconciliation',
        'STOCK_COUNT',
        p_stock_count_id::text,
        null,
        jsonb_build_object('counted_quantity',v_line.counted_quantity,'expected_quantity',v_current),
        now()
      );
    end if;
  end loop;

  update public.inventory_stock_counts
  set status='COMPLETED', counted_at=now(), completed_by=(select auth.uid()), updated_at=now()
  where id=p_stock_count_id;

  insert into public.audit_logs(
    organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata
  )
  values(
    v_count.organization_id,
    v_count.branch_id,
    auth.uid(),
    'inventory.stock_count.completed',
    'inventory_stock_count',
    p_stock_count_id::text,
    jsonb_build_object(
      'stock_count_id',p_stock_count_id,
      'line_count',v_line_count,
      'expected_quantity_total',v_total_expected,
      'counted_quantity_total',v_total_counted,
      'quantity_delta_total',v_total_delta,
      'notes',v_count.notes
    )
  );

  return p_stock_count_id;
end;
$$;
