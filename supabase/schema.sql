-- Run once in Supabase SQL editor. Create your user in Authentication first.
create extension if not exists pgcrypto;
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 90),
  description text not null check (char_length(description) between 10 and 5000),
  category text not null check (char_length(category) between 2 and 50),
  version text not null check (char_length(version) between 1 and 40),
  icon_url text,
  apk_path text unique,
  download_url text,
  requires_external_account boolean not null default false,
  account_url text,
  created_at timestamptz not null default now(),
  constraint account_link check (not requires_external_account or account_url ~ '^https://'),
  constraint apps_download_source_check check ((apk_path is not null and download_url is null) or (apk_path is null and download_url is not null and download_url ~* '^https://[^[:space:]]+$'))
);
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 2 and 800),
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique (app_id, author_id)
);
create or replace function public.is_admin() returns boolean language sql stable security definer
set search_path = public as $$ select exists(select 1 from public.admins where user_id = (select auth.uid())); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;
alter table public.admins enable row level security;
alter table public.apps enable row level security;
alter table public.reviews enable row level security;
create policy "read own admin status" on public.admins for select to authenticated using (user_id = (select auth.uid()));
create policy "read apps" on public.apps for select to anon, authenticated using (true);
create policy "admin add apps" on public.apps for insert to authenticated with check (public.is_admin());
create policy "admin edit apps" on public.apps for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin remove apps" on public.apps for delete to authenticated using (public.is_admin());
create policy "read reviews" on public.reviews for select to anon, authenticated using (true);
create policy "write own review" on public.reviews for insert to authenticated with check (author_id = (select auth.uid()));
create policy "edit own review" on public.reviews for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "remove own or admin review" on public.reviews for delete to authenticated using (author_id = (select auth.uid()) or public.is_admin());
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('apks', 'apks', true, 104857600, array['application/vnd.android.package-archive','application/octet-stream'])
on conflict (id) do nothing;
create policy "admin upload apks" on storage.objects for insert to authenticated
with check (bucket_id = 'apks' and public.is_admin() and name ~ '^[0-9a-f-]+/[0-9a-f-]+\.apk$');
create policy "admin delete apks" on storage.objects for delete to authenticated
using (bucket_id = 'apks' and public.is_admin());
-- Replace UUID with YOUR own auth.users.id. Never add this from the mobile app.
-- insert into public.admins (user_id) values ('YOUR-AUTH-USER-UUID');
