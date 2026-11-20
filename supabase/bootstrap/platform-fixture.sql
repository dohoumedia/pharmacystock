-- Local proof only: minimal Supabase Auth SQL contract, never a hosted migration.
-- Does not configure an Auth service or claim real authentication coverage.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, instance_id uuid, aud text, role text, email text,
 encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz,
 updated_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
