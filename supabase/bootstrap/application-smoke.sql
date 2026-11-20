-- Ordinary domain RPC compatibility on the complete canonical schema.
-- Fictional identity; no Auth service, network or frontend simulation.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
values('cb000000-0000-0000-0000-000000000001','bootstrap@example.invalid',now(),'{}');
select set_config('request.jwt.claim.sub','cb000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare ctx jsonb; org uuid; br uuid; product uuid; batch uuid; supplier uuid; po uuid; pol uuid;
 receipt uuid; sale uuid; quote jsonb; report jsonb; payload jsonb;
begin
 ctx:=public.complete_owner_setup('Canonical smoke pharmacy','Main','CA','CAD','America/Toronto','fr');
 org:=(ctx->>'organization_id')::uuid; br:=(ctx->>'branch_id')::uuid;
 if ctx is distinct from public.complete_owner_setup('Canonical smoke pharmacy','Main','CA','CAD','America/Toronto','fr') then raise exception 'owner setup retry'; end if;
 product:=public.create_catalog_product(org,'{"name":"Canonical medicine","sku":"CANONICAL","barcode":"000CB001","stock_unit":"tablet"}');
 if not exists(select 1 from public.search_catalog_products(org,'000CB001') where id=product) then raise exception 'catalog barcode search'; end if;
 batch:=public.post_opening_stock(org,br,product,'OPEN',current_date+30,10,1,3,'Opening','cb:opening');
 if batch is distinct from public.post_opening_stock(org,br,product,'OPEN',current_date+30,10,1,3,'Opening','cb:opening') then raise exception 'opening retry'; end if;
 if (select on_hand_quantity from public.inventory_balances where batch_id=batch) is distinct from 10::numeric then raise exception 'opening ledger balance'; end if;
 insert into public.suppliers(organization_id,name) values(org,'Canonical supplier') returning id into supplier;
 po:=public.create_purchase_order(org,br,supplier,'CB-PO',null,null,jsonb_build_array(jsonb_build_object('product_id',product,'quantity',4,'unit_cost',2)),'cb:po');
 select id into strict pol from public.purchase_order_lines where purchase_order_id=po;
 payload:=jsonb_build_array(jsonb_build_object('purchase_order_line_id',pol,'quantity',4,'unit_cost',2,'selling_price',5,'lot_number','RECEIVED','expiry_date',current_date+60));
 receipt:=public.receive_purchase_order(po,'CB-RECEIPT',null,payload,null,'cb:receipt');
 if receipt is distinct from public.receive_purchase_order(po,'CB-RECEIPT',null,payload,null,'cb:receipt') then raise exception 'receiving retry'; end if;
 if (select status from public.purchase_orders where id=po) is distinct from 'received' then raise exception 'purchase status'; end if;
 if (select count(*) from public.inventory_movements where branch_id=br)<>2 then raise exception 'opening plus receiving ledger'; end if;
 quote:=public.quote_sale(org,br,jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2)));
 if (quote->>'total_amount')::numeric is distinct from 6::numeric then raise exception 'FEFO batch price'; end if;
 sale:=public.complete_sale_with_customer(org,br,'CB-SALE',jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2)), '[{"method":"CASH","amount":6}]','cb:sale',null,null,quote,10);
 if sale is distinct from public.complete_sale_with_customer(org,br,'CB-SALE',jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2)), '[{"method":"CASH","amount":6}]','cb:sale',null,null,quote,10) then raise exception 'sale retry'; end if;
 if (select on_hand_quantity from public.inventory_balances where batch_id=batch) is distinct from 8::numeric then raise exception 'sale ledger'; end if;
 if not exists(select 1 from public.payments where sale_id=sale and amount=6 and change_amount=4) then raise exception 'payment'; end if;
 report:=public.read_operational_report(org,br,'sales',(now() at time zone 'America/Toronto')::date,(now() at time zone 'America/Toronto')::date);
 if (report#>>'{summary,gross}')::numeric is distinct from 6::numeric then raise exception 'report sales'; end if;
 if exists(select 1 from public.inventory_balances b where b.branch_id=br and b.on_hand_quantity is distinct from (select sum(m.quantity_delta) from public.inventory_movements m where m.batch_id=b.batch_id and m.branch_id=b.branch_id)) then raise exception 'ledger reconciliation'; end if;
 raise notice 'PASS 13 application compatibility assertions: owner/catalog/opening/purchasing/inventory/quote/sale/report';
end $$;
rollback;
