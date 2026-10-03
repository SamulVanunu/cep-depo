create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

create type public.profile_status as enum ('active', 'suspended');
create type public.review_moderation_status as enum ('visible', 'hidden');
create type public.report_reason as enum ('acilmiyor', 'link_bozuk', 'sahte_uygulama', 'diger');
create type public.report_status as enum ('open', 'resolved', 'dismissed');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext not null unique,
  avatar_path text,
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format_check check (
    username::text = btrim(username::text)
    and username::text ~ '^[A-Za-z0-9](?:[A-Za-z0-9]|[._](?=[A-Za-z0-9])){1,28}[A-Za-z0-9]$'
  ),
  constraint profiles_avatar_path_check check (
    avatar_path is null
    or (
      char_length(avatar_path) between 1 and 500
      and avatar_path !~ '(^|/)\.\.(/|$)'
      and avatar_path ~ ('^' || user_id::text || '/avatar\.(png|jpg|jpeg|webp)$')
    )
  )
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text,
  moderation_status public.review_moderation_status not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_app_user_key unique (app_id, user_id),
  constraint reviews_body_check check (
    body is null
    or (body = btrim(body) and char_length(body) between 3 and 2000)
  )
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(user_id) on delete cascade,
  app_id uuid not null references public.apps(id) on delete cascade,
  version_id uuid,
  reason public.report_reason not null,
  description text,
  status public.report_status not null default 'open',
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint reports_version_app_fkey
    foreign key (version_id, app_id)
    references public.app_versions(id, app_id)
    on delete cascade,
  constraint reports_description_check check (
    description is null
    or (description = btrim(description) and char_length(description) between 3 and 1000)
  ),
  constraint reports_resolution_check check (
    (status = 'open' and resolved_at is null)
    or (status in ('resolved', 'dismissed') and resolved_at is not null)
  )
);

create index profiles_status_idx on public.profiles(status);
create index reviews_app_id_idx on public.reviews(app_id);
create index reviews_user_id_idx on public.reviews(user_id);
create index reviews_visible_app_created_idx
  on public.reviews(app_id, created_at desc)
  where moderation_status = 'visible';
create index reviews_user_created_idx on public.reviews(user_id, created_at desc);
create index reports_reporter_created_idx on public.reports(reporter_id, created_at desc);
create index reports_app_id_idx on public.reports(app_id);
create index reports_version_id_idx on public.reports(version_id) where version_id is not null;
create unique index reports_one_open_app_target_idx
  on public.reports(reporter_id, app_id)
  where status = 'open' and version_id is null;
create unique index reports_one_open_version_target_idx
  on public.reports(reporter_id, app_id, version_id)
  where status = 'open' and version_id is not null;

create function private.set_community_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.normalize_review_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.body = nullif(btrim(new.body), '');

  if tg_op = 'UPDATE' then
    new.updated_at = now();
  end if;

  return new;
end;
$$;

create function private.normalize_report_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.description = nullif(btrim(new.description), '');
  new.admin_note = nullif(btrim(new.admin_note), '');
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function private.set_community_updated_at();

create trigger reviews_normalize_fields
before insert or update on public.reviews
for each row
execute function private.normalize_review_fields();

create trigger reports_normalize_fields
before insert or update on public.reports
for each row
execute function private.normalize_report_fields();

create function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username = btrim(new.raw_user_meta_data->>'username');

  if requested_username is null
    or requested_username !~ '^[A-Za-z0-9](?:[A-Za-z0-9]|[._](?=[A-Za-z0-9])){1,28}[A-Za-z0-9]$'
  then
    raise exception using
      errcode = '23514',
      message = 'Invalid username metadata.';
  end if;

  insert into public.profiles (user_id, username)
  values (new.id, requested_username::extensions.citext);

  return new;
end;
$$;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row
execute function private.handle_new_user_profile();

create function private.can_write_community()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as auth_user
    join public.profiles as profile on profile.user_id = auth_user.id
    where auth_user.id = (select auth.uid())
      and auth_user.email_confirmed_at is not null
      and profile.status = 'active'
  );
$$;

revoke all on function private.set_community_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.normalize_review_fields() from public, anon, authenticated, service_role;
revoke all on function private.normalize_report_fields() from public, anon, authenticated, service_role;
revoke all on function private.handle_new_user_profile() from public, anon, authenticated, service_role;
revoke all on function private.can_write_community() from public, anon, authenticated, service_role;
grant execute on function private.can_write_community() to authenticated;

create view public.review_rating_summaries
with (security_invoker = true)
as
select
  review.app_id,
  count(*)::bigint as review_count,
  avg(review.rating)::numeric(10, 2) as average_rating
from public.reviews as review
join public.apps as app on app.id = review.app_id
where app.status = 'active'
  and review.moderation_status = 'visible'
group by review.app_id;

alter table public.profiles enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;

grant select on public.profiles to anon, authenticated;
grant update (username, avatar_path) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

grant select on public.reviews to anon, authenticated;
grant insert (app_id, user_id, rating, body) on public.reviews to authenticated;
grant update (rating, body) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;
grant select, insert, update, delete on public.reviews to service_role;

grant select on public.reports to authenticated;
grant insert (reporter_id, app_id, version_id, reason, description) on public.reports to authenticated;
grant select, insert, update, delete on public.reports to service_role;

grant select on public.review_rating_summaries to anon, authenticated, service_role;

create policy profiles_public_or_owner_read
  on public.profiles
  for select
  to anon, authenticated
  using (status = 'active' or user_id = (select auth.uid()));

create policy profiles_owner_update
  on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()) and (select private.can_write_community()))
  with check (user_id = (select auth.uid()) and status = 'active' and (select private.can_write_community()));

create policy profiles_service_role_manage
  on public.profiles
  for all
  to service_role
  using (true)
  with check (true);

create policy reviews_public_read_visible
  on public.reviews
  for select
  to anon, authenticated
  using (
    moderation_status = 'visible'
    and exists (
      select 1
      from public.apps as app
      where app.id = reviews.app_id
        and app.status = 'active'
    )
  );

create policy reviews_owner_insert
  on public.reviews
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and moderation_status = 'visible'
    and (select private.can_write_community())
    and exists (
      select 1
      from public.apps as app
      where app.id = reviews.app_id
        and app.status = 'active'
    )
  );

create policy reviews_owner_update
  on public.reviews
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.can_write_community())
    and exists (
      select 1
      from public.apps as app
      where app.id = reviews.app_id
        and app.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and moderation_status = 'visible'
    and (select private.can_write_community())
    and exists (
      select 1
      from public.apps as app
      where app.id = reviews.app_id
        and app.status = 'active'
    )
  );

create policy reviews_owner_delete
  on public.reviews
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.can_write_community())
    and exists (
      select 1
      from public.apps as app
      where app.id = reviews.app_id
        and app.status = 'active'
    )
  );

create policy reviews_service_role_manage
  on public.reviews
  for all
  to service_role
  using (true)
  with check (true);

create policy reports_owner_read
  on public.reports
  for select
  to authenticated
  using (reporter_id = (select auth.uid()));

create policy reports_owner_insert
  on public.reports
  for insert
  to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and admin_note is null
    and resolved_at is null
    and (select private.can_write_community())
    and exists (
      select 1
      from public.apps as app
      where app.id = reports.app_id
        and app.status = 'active'
    )
    and (
      version_id is null
      or exists (
        select 1
        from public.app_versions as version
        where version.id = reports.version_id
          and version.app_id = reports.app_id
          and version.status = 'published'
      )
    )
  );

create policy reports_service_role_manage
  on public.reports
  for all
  to service_role
  using (true)
  with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

revoke insert, update, delete on storage.objects from public, anon;
grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;
grant select, insert, update, delete on storage.objects to service_role;

create policy avatars_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

create policy avatars_owner_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(png|jpg|jpeg|webp)$')
    and (select private.can_write_community())
  );

create policy avatars_owner_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(png|jpg|jpeg|webp)$')
    and (select private.can_write_community())
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(png|jpg|jpeg|webp)$')
    and (select private.can_write_community())
  );

create policy avatars_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(png|jpg|jpeg|webp)$')
    and (select private.can_write_community())
  );

create policy avatars_service_role_manage
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');
