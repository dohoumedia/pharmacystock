-- Ordinary owner/staff acceptance. Disposable PostgreSQL only, never hosted.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001','owner@example.test',now(),'{}'),
 ('10000000-0000-0000-0000-000000000002','staff@example.test',now(),'{}'),
 ('10000000-0000-0000-0000-000000000003','expired@example.test',now(),'{}');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare result jsonb; org_id uuid; main_id uuid; east_id uuid:=gen_random_uuid(); invite uuid; role_value uuid;
begin
 result:=public.complete_owner_setup('Staff fixture pharmacy','Main','CA','CAD','America/Toronto','en');
 org_id:=(result->>'organization_id')::uuid; main_id:=(result->>'branch_id')::uuid;
 perform public.create_branch_with_access(east_id,org_id,'East','EAST',null,null);
 select id into role_value from public.roles where code='CASHIER' and organization_id is null;
 invite:=public.invite_staff(org_id,'staff@example.test','Colleague',role_value,main_id);
 if public.invite_staff(org_id,' STAFF@example.test ','Colleague',role_value,main_id)<>invite then raise exception 'FAIL duplicate invitation retry'; end if;
 begin perform public.invite_staff(org_id,'invalid','Colleague',role_value,main_id); raise exception 'FAIL invalid email'; exception when raise_exception then if sqlerrm<>'INVITATION_INVALID' then raise; end if; end;
 begin perform public.invite_staff(org_id,'staff@example.test','Different',role_value,main_id); raise exception 'FAIL duplicate changed invite'; exception when raise_exception then if sqlerrm<>'INVITATION_PENDING' then raise; end if; end;
 perform set_config('test.org',org_id::text,true); perform set_config('test.main',main_id::text,true); perform set_config('test.east',east_id::text,true); perform set_config('test.invite',invite::text,true);
 raise notice 'PASS invite / duplicate retry / invalid email / conflicting invitation';
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ declare org_id uuid:=current_setting('test.org')::uuid; invite uuid:=current_setting('test.invite')::uuid;
begin
 if (select count(*) from public.my_staff_invitations())<>1 then raise exception 'FAIL inbox'; end if;
 if public.accept_staff_invitation(invite)<>org_id or public.accept_staff_invitation(invite)<>org_id then raise exception 'FAIL acceptance retry'; end if;
 if (select count(*) from public.branches where organization_id=org_id)<>1 then raise exception 'FAIL one assigned branch'; end if;
 raise notice 'PASS verified email acceptance / duplicate acceptance / single branch context';
end $$;
reset role;
-- Historical business actor fixture; the package never alters any sales/ledger table.
create table public.staff_fixture_retained_history(actor_user_id uuid references auth.users(id));
insert into public.staff_fixture_retained_history values('10000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare member public.organization_memberships; old_state jsonb; next_state jsonb; before_count bigint; owner_id uuid;
begin
 select * into member from public.organization_memberships where user_id='10000000-0000-0000-0000-000000000002';
 perform set_config('test.member',member.id::text,true);
 old_state:=jsonb_build_object('role_id',member.role_id,'status','active','branch_ids',array[current_setting('test.main')::uuid]);
 next_state:=jsonb_set(old_state,'{branch_ids}',(select jsonb_agg(id order by id) from unnest(array[current_setting('test.main')::uuid,current_setting('test.east')::uuid]) id));
 perform public.maintain_staff_access(member.id,old_state,next_state);
 select count(*) into before_count from public.audit_logs where event_type='staff.branches_changed';
 perform public.maintain_staff_access(member.id,old_state,next_state);
 if (select count(*) from public.audit_logs where event_type='staff.branches_changed')<>before_count then raise exception 'FAIL duplicate branch audit on retry'; end if;
 if (select count(*) from public.branch_memberships where organization_membership_id=member.id)<>2 then raise exception 'FAIL branch add'; end if;
 old_state:=next_state;
 next_state:=jsonb_set(old_state,'{role_id}',to_jsonb((select id from public.roles where code='INVENTORY_OFFICER' and organization_id is null)));
 perform public.maintain_staff_access(member.id,old_state,next_state);
 begin perform public.maintain_staff_access(member.id,old_state,jsonb_set(old_state,'{status}','"suspended"')); raise exception 'FAIL stale manager overwrite'; exception when raise_exception then if sqlerrm<>'STAFF_ACCESS_CHANGED' then raise; end if; end;
 old_state:=next_state; next_state:=jsonb_set(old_state,'{branch_ids}',jsonb_build_array(current_setting('test.east')));
 perform public.maintain_staff_access(member.id,old_state,next_state);
 perform public.maintain_staff_access(member.id,next_state,jsonb_set(next_state,'{branch_ids}','[]'));
 if exists(select 1 from public.branch_memberships where organization_membership_id=member.id) then raise exception 'FAIL empty branch access'; end if;
 perform set_config('request.jwt.claim.sub',member.user_id::text,true);
 if exists(select 1 from public.branches where organization_id=member.organization_id) then raise exception 'FAIL no-access branch context'; end if;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 perform public.maintain_staff_access(member.id,jsonb_set(next_state,'{branch_ids}','[]'),next_state);
 perform set_config('test.active_state',next_state::text,true);
 if not exists(select 1 from public.staff_directory_details(current_setting('test.org')::uuid) where user_id=member.user_id and email='staff@example.test' and access_changed_at is not null) then raise exception 'FAIL directory identity/status metadata'; end if;
 select id into owner_id from public.organization_memberships where user_id=auth.uid();
 begin perform public.maintain_staff_access(owner_id,'{}','{}'); raise exception 'FAIL self management'; exception when raise_exception then if sqlerrm<>'AUTH_FORBIDDEN' then raise; end if; end;
 raise notice 'PASS branch add / exact retry / role change / stale review / branch removal / zero-access state / directory';
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.branches where id=current_setting('test.main')::uuid) then raise exception 'FAIL removed branch still visible'; end if;
 if not exists(select 1 from public.branches where id=current_setting('test.east')::uuid) then raise exception 'FAIL second branch not visible'; end if;
 if not app_private.has_permission(current_setting('test.org')::uuid,'inventory.adjust') or app_private.has_permission(current_setting('test.org')::uuid,'staff.manage') then raise exception 'FAIL role permissions after change'; end if;
 raise notice 'PASS existing staff sees valid remaining branch and updated role permissions';
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.maintain_staff_access(current_setting('test.member')::uuid,current_setting('test.active_state')::jsonb,jsonb_set(current_setting('test.active_state')::jsonb,'{status}','"suspended"'));
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.organizations where id=current_setting('test.org')::uuid) then raise exception 'FAIL suspended access'; end if;
 if not public.my_membership_unavailable() then raise exception 'FAIL inactive membership guidance'; end if;
 raise notice 'PASS deactivated membership has clear no-access context';
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.maintain_staff_access(current_setting('test.member')::uuid,jsonb_set(current_setting('test.active_state')::jsonb,'{status}','"suspended"'),current_setting('test.active_state')::jsonb);
do $$ declare org_id uuid:=current_setting('test.org')::uuid; role_value uuid; invite uuid; renewed uuid;
begin
 select id into role_value from public.roles where code='CASHIER' and organization_id is null;
 invite:=public.invite_staff(org_id,'expired@example.test','Expired',role_value,current_setting('test.main')::uuid);
 perform public.cancel_staff_invitation(invite); perform public.cancel_staff_invitation(invite);
 renewed:=public.invite_staff(org_id,'expired@example.test','Expired',role_value,current_setting('test.main')::uuid);
 if renewed=invite then raise exception 'FAIL cancelled reissue'; end if;
 perform set_config('test.expired',renewed::text,true);
 raise notice 'PASS revoke pending / revoke retry / cancelled reissue';
end $$;
reset role;
update public.staff_invitations set expires_at=now()-interval '1 second' where id=current_setting('test.expired')::uuid;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
 begin perform public.accept_staff_invitation(current_setting('test.expired')::uuid); raise exception 'FAIL expired accept'; exception when raise_exception then if sqlerrm<>'INVITATION_UNAVAILABLE' then raise; end if; end;
 begin perform public.accept_staff_invitation(gen_random_uuid()); raise exception 'FAIL invalid invite'; exception when raise_exception then if sqlerrm<>'INVITATION_UNAVAILABLE' then raise; end if; end;
 if exists(select 1 from public.my_staff_invitations()) then raise exception 'FAIL expired inbox'; end if;
 raise notice 'PASS expired and invalid invitation guidance boundary';
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare renewed uuid; begin
 renewed:=public.invite_staff(current_setting('test.org')::uuid,'expired@example.test','Expired',(select id from public.roles where code='CASHIER' and organization_id is null),current_setting('test.main')::uuid);
 if renewed=current_setting('test.expired')::uuid then raise exception 'FAIL expired reissue'; end if;
 raise notice 'PASS expired reissue creates one new pending invitation';
end $$;
reset role;
do $$ begin
 if not exists(select 1 from public.organization_memberships where id=current_setting('test.member')::uuid and status='active') then raise exception 'FAIL reactivation'; end if;
 if (select actor_user_id from public.staff_fixture_retained_history)<>'10000000-0000-0000-0000-000000000002' or not exists(select 1 from public.profiles where user_id='10000000-0000-0000-0000-000000000002' and display_name='Colleague') then raise exception 'FAIL historical identity'; end if;
 raise notice 'PASS reactivation retains membership id / profile / historical actor reference';
end $$;
-- Prepare and restore a legacy revoked membership with neither role nor branches.
update public.organization_memberships set role_id=null,status='revoked' where id=current_setting('test.member')::uuid;
delete from public.branch_memberships where organization_membership_id=current_setting('test.member')::uuid;
set local role authenticated;
do $$ declare original jsonb; prepared jsonb; assigned jsonb; begin
 original:=jsonb_build_object('role_id',null,'status','revoked','branch_ids','[]'::jsonb);
 prepared:=jsonb_build_object('role_id',(select id from public.roles where code='CASHIER' and organization_id is null),'status','suspended','branch_ids','[]'::jsonb);
 perform public.maintain_staff_access(current_setting('test.member')::uuid,original,prepared);
 assigned:=jsonb_set(prepared,'{branch_ids}',jsonb_build_array(current_setting('test.main')));
 perform public.maintain_staff_access(current_setting('test.member')::uuid,prepared,assigned);
 perform public.maintain_staff_access(current_setting('test.member')::uuid,assigned,jsonb_set(assigned,'{status}','"active"'));
 if not exists(select 1 from public.organization_memberships where id=current_setting('test.member')::uuid and status='active' and role_id is not null) then raise exception 'FAIL legacy restore'; end if;
 raise notice 'PASS legacy role-less branch-less revoked member prepared and restored';
end $$;
reset role;
rollback;
