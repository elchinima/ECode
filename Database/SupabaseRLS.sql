-- Supabase / PostgreSQL RLS setup for ECode tables.
-- Run in Supabase SQL Editor.

begin;

-- 1) Enable RLS on public tables reported by Security Advisor
alter table if exists public.users enable row level security;
alter table if exists public.categories enable row level security;
alter table if exists public.qr_codes enable row level security;
alter table if exists public.qr_scan_events enable row level security;

-- 2) Idempotent cleanup of previous policies (if they exist)
drop policy if exists users_service_role_all on public.users;
drop policy if exists categories_service_role_all on public.categories;
drop policy if exists qr_codes_service_role_all on public.qr_codes;
drop policy if exists qr_scan_events_service_role_all on public.qr_scan_events;

-- 3) Allow only service_role token to use PostgREST on these tables
-- (safe default for backend-only access)
create policy users_service_role_all
on public.users
for all
to service_role
using (true)
with check (true);

create policy categories_service_role_all
on public.categories
for all
to service_role
using (true)
with check (true);

create policy qr_codes_service_role_all
on public.qr_codes
for all
to service_role
using (true)
with check (true);

create policy qr_scan_events_service_role_all
on public.qr_scan_events
for all
to service_role
using (true)
with check (true);

commit;

-- Optional diagnostics:
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in ('users','categories','qr_codes','qr_scan_events');
