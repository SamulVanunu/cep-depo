create extension if not exists citext with schema extensions;
create extension if not exists unaccent with schema extensions;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create type public.app_role as enum ('admin');
create type public.app_status as enum ('active', 'archived');
create type public.version_status as enum ('draft', 'published', 'withdrawn');

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name extensions.citext not null unique,
  slug extensions.citext not null unique
    check (slug::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  position integer not null default 0 check (position >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  slug extensions.citext not null unique
    check (slug::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 2 and 90),
  short_description text not null check (char_length(short_description) between 10 and 180),
  description text not null check (char_length(description) between 10 and 5000),
  icon_path text check (
    icon_path is null
    or (char_length(icon_path) between 1 and 500 and icon_path !~ '(^|/)\.\.(/|$)')
  ),
  status public.app_status not null default 'active',
  featured boolean not null default false,
  download_count bigint not null default 0 check (download_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_versions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  version_name text not null check (char_length(version_name) between 1 and 40),
  version_code integer not null check (version_code > 0),
  changelog text not null default '' check (char_length(changelog) <= 5000),
  apk_path text not null unique check (
    apk_path ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
  ),
  apk_size_bytes bigint not null check (apk_size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status public.version_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint app_versions_app_code_key unique (app_id, version_code),
  constraint app_versions_id_app_key unique (id, app_id),
  constraint app_versions_publication_check check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'withdrawn') and published_at is not null)
  )
);

create table public.app_screenshots (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  path text not null unique check (
    char_length(path) between 1 and 500 and path !~ '(^|/)\.\.(/|$)'
  ),
  alt_text text not null check (char_length(alt_text) between 2 and 180),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint app_screenshots_app_position_key unique (app_id, position)
);

create table public.download_events (
  id bigint generated always as identity primary key,
  app_id uuid not null references public.apps(id) on delete cascade,
  version_id uuid not null,
  installation_id uuid not null,
  downloaded_at timestamptz not null default now(),
  constraint download_events_version_app_fkey
    foreign key (version_id, app_id)
    references public.app_versions(id, app_id)
    on delete cascade,
  constraint download_events_version_installation_key
    unique (version_id, installation_id)
);

create index apps_category_id_idx on public.apps(category_id);
create index apps_active_popular_idx on public.apps(download_count desc, title)
  where status = 'active';
create index app_versions_app_id_idx on public.app_versions(app_id);
create index app_versions_published_latest_idx
  on public.app_versions(app_id, version_code desc)
  where status = 'published';
create index app_screenshots_app_id_idx on public.app_screenshots(app_id);
create index download_events_app_id_idx on public.download_events(app_id);
create index download_events_version_id_idx on public.download_events(version_id);

alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.apps enable row level security;
alter table public.app_versions enable row level security;
alter table public.app_screenshots enable row level security;
alter table public.download_events enable row level security;

create policy categories_public_read
  on public.categories
  for select
  to anon, authenticated
  using (is_active);

create policy apps_public_read
  on public.apps
  for select
  to anon, authenticated
  using (status = 'active');

create policy app_versions_public_read
  on public.app_versions
  for select
  to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.apps
      where apps.id = app_versions.app_id
        and apps.status = 'active'
    )
  );

create policy app_screenshots_public_read
  on public.app_screenshots
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.apps
      where apps.id = app_screenshots.app_id
        and apps.status = 'active'
    )
  );

grant select on public.categories, public.apps, public.app_versions, public.app_screenshots
  to anon, authenticated;
grant select, insert, update, delete
  on public.user_roles, public.categories, public.apps, public.app_versions,
     public.app_screenshots, public.download_events
  to service_role;
grant usage, select on sequence public.download_events_id_seq to service_role;

create view public.catalog_app_cards
with (security_invoker = true)
as
select
  app.id as app_id,
  app.slug,
  app.title,
  app.short_description,
  app.icon_path,
  category.id as category_id,
  category.name as category_name,
  category.slug as category_slug,
  app.featured,
  app.download_count,
  version.id as version_id,
  version.version_name,
  version.version_code,
  version.changelog as version_changelog,
  version.apk_path,
  version.apk_size_bytes,
  version.sha256,
  version.published_at
from public.apps as app
join public.categories as category on category.id = app.category_id
join lateral (
  select candidate.*
  from public.app_versions as candidate
  where candidate.app_id = app.id
    and candidate.status = 'published'
  order by candidate.version_code desc
  limit 1
) as version on true
where app.status = 'active'
  and category.is_active;

grant select on public.catalog_app_cards to anon, authenticated, service_role;

create function public.search_catalog(
  p_query text,
  p_category_slug text,
  p_sort text
)
returns setof public.catalog_app_cards
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_sort not in ('popular', 'newest') then
    raise exception using
      errcode = '22023',
      message = format('Desteklenmeyen katalog sıralaması: %s', p_sort);
  end if;

  return query
  select card.*
  from public.catalog_app_cards as card
  where (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or strpos(
        extensions.unaccent(lower(card.title)),
        extensions.unaccent(lower(btrim(p_query)))
      ) > 0
      or strpos(
        extensions.unaccent(lower(card.short_description)),
        extensions.unaccent(lower(btrim(p_query)))
      ) > 0
      or strpos(
        extensions.unaccent(lower(card.category_name::text)),
        extensions.unaccent(lower(btrim(p_query)))
      ) > 0
    )
    and (
      nullif(btrim(coalesce(p_category_slug, '')), '') is null
      or card.category_slug = btrim(p_category_slug)::extensions.citext
    )
  order by
    case when p_sort = 'popular' then card.download_count end desc,
    case when p_sort = 'newest' then card.published_at end desc,
    card.title asc;
end;
$$;

revoke all on function public.search_catalog(text, text, text) from public;
grant execute on function public.search_catalog(text, text, text)
  to anon, authenticated, service_role;

create function public.record_download(
  p_version_id uuid,
  p_installation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_app_id uuid;
  was_inserted boolean;
begin
  select version.app_id
  into target_app_id
  from public.app_versions as version
  join public.apps as app on app.id = version.app_id
  where version.id = p_version_id
    and version.status = 'published'
    and app.status = 'active';

  if target_app_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Yayımlanmış sürüm bulunamadı.';
  end if;

  with inserted as (
    insert into public.download_events (app_id, version_id, installation_id)
    values (target_app_id, p_version_id, p_installation_id)
    on conflict (version_id, installation_id) do nothing
    returning 1
  )
  select exists(select 1 from inserted) into was_inserted;

  if was_inserted then
    update public.apps
    set download_count = download_count + 1,
        updated_at = now()
    where id = target_app_id;
  end if;

  return was_inserted;
end;
$$;

revoke all on function public.record_download(uuid, uuid) from public;
grant execute on function public.record_download(uuid, uuid)
  to anon, authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'apk-drafts',
    'apk-drafts',
    false,
    null,
    array['application/vnd.android.package-archive', 'application/octet-stream']
  ),
  (
    'apks',
    'apks',
    true,
    null,
    array['application/vnd.android.package-archive', 'application/octet-stream']
  ),
  (
    'app-assets',
    'app-assets',
    true,
    10485760,
    array['image/png', 'image/jpeg', 'image/webp']
  ),
  (
    'avatars',
    'avatars',
    false,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp']
  );

create policy published_files_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id in ('apks', 'app-assets'));
