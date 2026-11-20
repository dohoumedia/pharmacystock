-- Day-to-day customer assertions. Isolated disposable PostgreSQL only.
begin;
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
 pr uuid:='6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa'; customer uuid:='ca000000-0000-0000-0000-000000000001'; s uuid; item uuid; rf uuid; anon_sale uuid;
begin
 insert into public.customers(id,organization_id,full_name,phone,email,preferred_locale) values(customer,org,'Customer before edit','5145550199','History@example.test','en');
 if exists(select 1 from public.sales where customer_id=customer) then raise exception 'new customer history must be empty'; end if;
 begin
  insert into public.customers(organization_id,full_name,phone) values(org,'Other person','5145550199');
  raise exception 'duplicate phone accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.customers(organization_id,full_name,email) values(org,'Other person','history@EXAMPLE.test');
  raise exception 'duplicate email accepted';
 exception when unique_violation then null; end;
 s:=public.complete_sale_with_customer(org,br,'CUSTOMER-HISTORY',jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',2)), '[{"method":"CASH","amount":20}]','customer-sale',null,customer);
 if (select customer_id is distinct from customer from public.sales where id=s) then raise exception 'sale customer missing'; end if;
 update public.customers set full_name='Customer after edit',phone='5145550188' where id=customer;
 if not exists(select 1 from public.sales where id=s and customer_id=customer and total_amount=20) then raise exception 'customer edit rewrote transaction'; end if;
 select id into item from public.sale_items where sale_id=s order by id limit 1;
 rf:=public.refund_sale(s,'CUSTOMER-PARTIAL',jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',0.5)),'customer-partial','Customer return');
 if rf is distinct from public.refund_sale(s,'CUSTOMER-PARTIAL',jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',0.5)),'customer-partial','Customer return') then raise exception 'refund retry duplicated'; end if;
 if not exists(select 1 from public.sale_refunds r join public.sales sale on sale.id=r.sale_id where r.id=rf and sale.customer_id=customer and sale.status='PARTIALLY_REFUNDED') then raise exception 'refund customer chain broken'; end if;
 update public.customers set status='archived' where id=customer;
 if not exists(select 1 from public.sales sale join public.customers c on c.id=sale.customer_id where sale.id=s and c.status='archived') then raise exception 'archived history disappeared'; end if;
 anon_sale:=public.complete_sale_with_customer(org,br,'CUSTOMER-ANONYMOUS',jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',1)), '[{"method":"CARD","amount":10}]','customer-anonymous');
 if (select customer_id is not null from public.sales where id=anon_sale) then raise exception 'anonymous customer forced'; end if;
 if (select count(*) from public.payments where sale_id=s)<>1 then raise exception 'customer sale payment changed'; end if;
 if exists(select 1 from public.inventory_balances where available_quantity<0) then raise exception 'negative balance'; end if;
 if exists(select 1 from public.sale_items i left join public.inventory_movements m on m.id=i.inventory_movement_id where i.sale_id in(s,anon_sale) and m.id is null) then raise exception 'sale ledger missing'; end if;
 -- Same names are legitimate; absent identifiers must not collapse people.
 insert into public.customers(organization_id,full_name) values(org,'Same name'),(org,'Same name');
end $$;
rollback;
-- Bounded directory browser fixture; intentionally no real customer information.
begin;
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into public.customers(organization_id,full_name,phone,email,preferred_locale)
select '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Fixture Customer '||lpad(n::text,3,'0'),'555'||lpad(n::text,7,'0'),'customer'||n||'@example.test',case when n%2=0 then 'fr' else 'en' end from generate_series(1,80) n;
commit;
