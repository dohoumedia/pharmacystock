insert into public.permissions(code,description_en,description_fr) values
('customer.read','View customers','Consulter les clients'),
('customer.manage','Manage customers','Gérer les clients'),
('reports.read','View operational reports','Consulter les rapports opérationnels'),
('reports.finance.read','View financial reports','Consulter les rapports financiers'),
('import.manage','Run imports and onboarding','Gérer les imports et l’onboarding'),
('notification.read','View notifications','Consulter les notifications'),
('settings.manage','Manage pharmacy settings','Gérer les paramètres de la pharmacie'),
('subscription.read','View subscription','Consulter l’abonnement')
on conflict(code) do update set description_en=excluded.description_en,description_fr=excluded.description_fr;

insert into public.role_permissions(role_id,permission_code)
select r.id,p.code from public.roles r cross join (values
('customer.read'),('reports.read'),('notification.read'),('subscription.read')) p(code)
where r.organization_id is null and r.code in ('OWNER','MANAGER','PHARMACIST','CASHIER','INVENTORY_OFFICER')
on conflict do nothing;
insert into public.role_permissions(role_id,permission_code)
select r.id,p.code from public.roles r cross join (values
('customer.manage'),('reports.finance.read'),('import.manage'),('settings.manage')) p(code)
where r.organization_id is null and r.code in ('OWNER','MANAGER')
on conflict do nothing;

create table public.customers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 full_name text not null, phone text, email text, preferred_locale text not null default 'fr' check(preferred_locale in ('fr','en')),
 marketing_consent boolean not null default false, service_notification_consent boolean not null default true,
 notes text, status text not null default 'active' check(status in ('active','archived')),
 created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create unique index customers_org_phone_unique on public.customers(organization_id,phone) where phone is not null and status='active';
create unique index customers_org_email_unique on public.customers(organization_id,lower(email)) where email is not null and status='active';
create index customers_org_name_idx on public.customers(organization_id,full_name);
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
alter table public.customers enable row level security;
create policy customers_read on public.customers for select to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'customer.read'));
create policy customers_insert on public.customers for insert to authenticated with check(created_by=auth.uid() and app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'customer.manage'));
create policy customers_update on public.customers for update to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'customer.manage')) with check(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'customer.manage'));
grant select,insert,update on public.customers to authenticated;

alter table public.sales add column if not exists customer_id uuid;
alter table public.sales add constraint sales_customer_fk foreign key(organization_id,customer_id) references public.customers(organization_id,id) on delete set null;
create index sales_org_customer_idx on public.sales(organization_id,customer_id) where customer_id is not null;

create table public.organization_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade, receipt_footer text,
 default_payment_method text not null default 'CASH' check(default_payment_method in ('CASH','CARD','MOBILE_MONEY','BANK_TRANSFER','OTHER')),
 allow_negative_stock boolean not null default false, low_stock_default_threshold numeric(18,4) not null default 5 check(low_stock_default_threshold>=0),
 notification_channels jsonb not null default '{"in_app":true,"email":false,"sms":false,"whatsapp":false,"push":false}'::jsonb,
 updated_by uuid default auth.uid() references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create trigger organization_settings_set_updated_at before update on public.organization_settings for each row execute function public.set_updated_at();
alter table public.organization_settings enable row level security;
create policy organization_settings_read on public.organization_settings for select to authenticated using(app_private.is_org_member(organization_id));
create policy organization_settings_insert on public.organization_settings for insert to authenticated with check(app_private.has_permission(organization_id,'settings.manage'));
create policy organization_settings_update on public.organization_settings for update to authenticated using(app_private.has_permission(organization_id,'settings.manage')) with check(app_private.has_permission(organization_id,'settings.manage'));
grant select,insert,update on public.organization_settings to authenticated;

create table public.notification_preferences (
 organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 in_app boolean not null default true, email boolean not null default false, sms boolean not null default false, whatsapp boolean not null default false,
 push boolean not null default false, updated_at timestamptz not null default now(), primary key(organization_id,user_id)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 branch_id uuid, recipient_user_id uuid not null references auth.users(id) on delete cascade, type text not null, title_key text not null,
 body_key text not null, payload jsonb not null default '{}'::jsonb, read_at timestamptz, created_at timestamptz not null default now(),
 foreign key(organization_id,branch_id) references public.branches(organization_id,id) on delete cascade
);
create index notifications_recipient_idx on public.notifications(recipient_user_id,created_at desc);
alter table public.notification_preferences enable row level security; alter table public.notifications enable row level security;
create policy notification_preferences_self on public.notification_preferences for all to authenticated using(user_id=auth.uid() and app_private.is_org_member(organization_id)) with check(user_id=auth.uid() and app_private.is_org_member(organization_id));
create policy notifications_self_read on public.notifications for select to authenticated using(recipient_user_id=auth.uid() and app_private.is_org_member(organization_id));
create policy notifications_self_update on public.notifications for update to authenticated using(recipient_user_id=auth.uid()) with check(recipient_user_id=auth.uid());
grant select,insert,update on public.notification_preferences to authenticated; grant select,update(read_at) on public.notifications to authenticated;

create table public.import_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, branch_id uuid,
 import_type text not null check(import_type in ('PRODUCTS','SUPPLIERS','OPENING_STOCK','CUSTOMERS')), file_name text,
 status text not null default 'DRAFT' check(status in ('DRAFT','VALIDATING','READY','COMMITTING','COMPLETED','FAILED','CANCELLED')),
 total_rows integer not null default 0 check(total_rows>=0), valid_rows integer not null default 0 check(valid_rows>=0), invalid_rows integer not null default 0 check(invalid_rows>=0),
 error_summary jsonb not null default '{}'::jsonb, created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), completed_at timestamptz, foreign key(organization_id,branch_id) references public.branches(organization_id,id) on delete restrict
);
create table public.import_rows (
 id bigint generated always as identity primary key, import_job_id uuid not null references public.import_jobs(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade, row_number integer not null, raw_data jsonb not null,
 normalized_data jsonb, status text not null default 'PENDING' check(status in ('PENDING','VALID','INVALID','IMPORTED','SKIPPED')),
 errors jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), unique(import_job_id,row_number)
);
create index import_jobs_org_created_idx on public.import_jobs(organization_id,created_at desc); create index import_rows_job_idx on public.import_rows(import_job_id,row_number);
alter table public.import_jobs enable row level security; alter table public.import_rows enable row level security;
create policy import_jobs_manage on public.import_jobs for all to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage')) with check(created_by=auth.uid() and app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage'));
create policy import_rows_manage on public.import_rows for all to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage')) with check(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage'));
grant select,insert,update on public.import_jobs,public.import_rows to authenticated;

create table public.subscription_plans (
 code text primary key, name text not null, monthly_price numeric(18,2) not null check(monthly_price>=0), currency_code text not null default 'XOF',
 included_branches integer not null default 1 check(included_branches>0), included_users integer not null default 3 check(included_users>0),
 features jsonb not null default '{}'::jsonb, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.subscriptions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id) on delete cascade,
 plan_code text not null references public.subscription_plans(code) on delete restrict,
 status text not null default 'TRIAL' check(status in ('TRIAL','ACTIVE','PAST_DUE','GRACE','SUSPENDED','CANCELLED')),
 trial_ends_at timestamptz, current_period_start timestamptz, current_period_end timestamptz, provider text, provider_reference text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
insert into public.subscription_plans(code,name,monthly_price,currency_code,included_branches,included_users,features) values('CORE_35000','Pharmacy Stock Core',35000,'XOF',1,3,'{"inventory":true,"expiry":true,"purchasing":true,"pos":true,"reports":true}'::jsonb) on conflict(code) do update set monthly_price=excluded.monthly_price,currency_code=excluded.currency_code,features=excluded.features;
alter table public.subscription_plans enable row level security; alter table public.subscriptions enable row level security;
create policy subscription_plans_read on public.subscription_plans for select to authenticated using(active=true);
create policy subscriptions_read on public.subscriptions for select to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'subscription.read'));
grant select on public.subscription_plans,public.subscriptions to authenticated;

create or replace view public.report_daily_sales with (security_invoker=true) as
select organization_id,branch_id,(completed_at at time zone 'UTC')::date as sale_date,count(*) filter(where status<>'VOIDED')::bigint as sale_count,
coalesce(sum(total_amount) filter(where status<>'VOIDED'),0)::numeric(18,2) as gross_sales from public.sales group by organization_id,branch_id,(completed_at at time zone 'UTC')::date;
create or replace view public.report_inventory_value with (security_invoker=true) as
select ib.organization_id,ib.branch_id,count(*) filter(where ib.on_hand_quantity>0)::bigint as stocked_batches,
coalesce(sum(ib.on_hand_quantity*coalesce(b.purchase_cost,0)),0)::numeric(18,2) as inventory_cost_value,
coalesce(sum(ib.on_hand_quantity*coalesce(b.selling_price,0)),0)::numeric(18,2) as inventory_retail_value
from public.inventory_balances ib join public.batches b on b.id=ib.batch_id and b.organization_id=ib.organization_id group by ib.organization_id,ib.branch_id;
grant select on public.report_daily_sales,public.report_inventory_value to authenticated;

create or replace function app_private.prevent_audit_mutation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin raise exception using errcode='55000',message='AUDIT_LOG_IMMUTABLE'; end $$;
drop trigger if exists audit_logs_immutable on public.audit_logs; create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function app_private.prevent_audit_mutation();
revoke update,delete on public.audit_logs from authenticated;
create index if not exists audit_logs_org_created_idx on public.audit_logs(organization_id,created_at desc);
create index if not exists sales_created_by_idx on public.sales(created_by); create index if not exists payments_created_by_idx on public.payments(created_by); create index if not exists sale_refunds_created_by_idx on public.sale_refunds(created_by);
