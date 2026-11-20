-- Test helper used by the complete existing expiry/transfer suites.
-- Not part of the bootstrap schema or exported baseline.
create function public.inventory_test_assert(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAILED: %',label; end if; end $$;
grant execute on function public.inventory_test_assert(boolean,text) to authenticated;
