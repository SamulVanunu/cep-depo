create type public.account_requirement as enum ('none', 'optional', 'required');

alter table public.app_versions
  add column supports_mobile boolean not null default true,
  add column supports_tv boolean not null default false,
  add column account_requirement public.account_requirement not null default 'none',
  add constraint app_versions_platform_support_check check (supports_mobile or supports_tv);

alter table public.app_versions validate constraint app_versions_platform_support_check;

create or replace function public.admin_record_external_action(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  audit_id uuid;
  safe_metadata jsonb;
  expected_target_type text;
  external_actions constant text[] = array[
    'app.create', 'app.update', 'app.archive', 'app.delete',
    'category.create', 'category.update',
    'asset.upload', 'asset.cleanup_pending',
    'screenshot.create', 'screenshot.update', 'screenshot.delete',
    'version.draft', 'version.replace', 'upload.cleanup',
    'user.delete', 'user.recovery_request'
  ];
begin
  perform private.require_admin_actor(p_actor_id);

  if not p_action = any (external_actions) then
    raise exception using errcode = 'P0001', message = 'Geçersiz yönetim işlemi.';
  end if;

  expected_target_type = case
    when p_action like 'app.%' then 'app'
    when p_action like 'category.%' then 'category'
    when p_action in ('asset.upload', 'asset.cleanup_pending') then 'asset'
    when p_action like 'screenshot.%' then 'screenshot'
    when p_action in ('version.draft', 'version.replace') then 'version'
    when p_action = 'upload.cleanup' then 'upload'
    when p_action like 'user.%' then 'user'
  end;

  if p_target_type is distinct from expected_target_type then
    raise exception using errcode = 'P0001', message = 'İşlem ve hedef türü eşleşmiyor.';
  end if;

  if p_action in ('app.delete', 'version.replace', 'asset.cleanup_pending')
    and p_target_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception using errcode = 'P0001', message = 'Geçersiz audit hedef kimliği.';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Geçersiz audit metadata.';
  end if;

  if p_action = 'asset.cleanup_pending' and not coalesce((
    jsonb_typeof(p_metadata->'bucket') = 'string'
    and jsonb_typeof(p_metadata->'path') = 'string'
    and jsonb_typeof(p_metadata->'operation_id') = 'string'
    and p_metadata->>'operation_id' = p_target_id
    and (
      (
        p_metadata->>'bucket' = 'apk-drafts'
        and p_metadata->>'path' ~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$'
      )
      or (
        p_metadata->>'bucket' = 'apks'
        and p_metadata->>'path' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
      )
      or (
        p_metadata->>'bucket' = 'app-assets'
        and p_metadata->>'path' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      )
    )
  ), false) then
    raise exception using errcode = 'P0001', message = 'Geçersiz cleanup audit metadata.';
  end if;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into safe_metadata
  from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as entry
  where case
    when entry.key in ('old_status', 'new_status', 'status') then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' = any (array[
        'active', 'archived', 'draft', 'published', 'withdrawn',
        'visible', 'hidden', 'open', 'resolved', 'dismissed', 'suspended'
      ])
    when entry.key in ('version_code', 'old_version_code', 'new_version_code') then
      jsonb_typeof(entry.value) = 'number'
      and entry.value #>> '{}' ~ '^[0-9]+$'
      and (entry.value #>> '{}')::numeric between 1 and 2147483647
    when entry.key = 'bucket' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' = any (array['apk-drafts', 'apks', 'app-assets'])
    when entry.key = 'path' then
      jsonb_typeof(entry.value) = 'string'
      and (
        entry.value #>> '{}' ~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$'
        or entry.value #>> '{}' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
        or entry.value #>> '{}' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      )
    when entry.key = 'operation_id' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when entry.key = 'partial' then
      jsonb_typeof(entry.value) = 'boolean'
    when entry.key = 'download_source' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' in ('storage', 'external')
    when entry.key = 'hostname' then
      jsonb_typeof(entry.value) = 'string'
      and char_length(entry.value #>> '{}') between 1 and 253
      and (
        entry.value #>> '{}' ~ '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
        or entry.value #>> '{}' ~ '^[0-9A-Fa-f]*:[0-9A-Fa-f:]+$'
      )
    when entry.key in ('supports_mobile', 'supports_tv') then
      jsonb_typeof(entry.value) = 'boolean'
    when entry.key = 'account_requirement' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' in ('none', 'optional', 'required')
    else false
  end;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_actor_id, p_action, p_target_type, p_target_id, safe_metadata)
  returning id into audit_id;

  return audit_id;
end;
$$;

-- Package identity is the unique source key for self-update releases. Fail before
-- creating the index so an unsafe production state gets an actionable message.
do $$
begin
  if exists (
    select package_name
    from public.apps
    where package_name is not null
    group by package_name
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Uygulama paket kimliği benzersiz olmalıdır.';
  end if;
end;
$$;

create unique index apps_package_name_unique_idx
  on public.apps (package_name)
  where package_name is not null;

drop function if exists public.search_catalog(text, text, text);
drop view if exists public.catalog_app_cards;

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
  version.published_at,
  version.download_source,
  version.apk_url,
  version.supports_mobile,
  version.supports_tv,
  version.account_requirement
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
  p_sort text,
  p_platform text default null
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

  if p_platform is not null and p_platform not in ('mobile', 'tv') then
    raise exception using
      errcode = '22023',
      message = format('Desteklenmeyen platform filtresi: %s', p_platform);
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
    and (
      p_platform is null
      or (p_platform = 'mobile' and card.supports_mobile)
      or (p_platform = 'tv' and card.supports_tv)
    )
  order by
    case when p_sort = 'popular' then card.download_count end desc,
    case when p_sort = 'newest' then card.published_at end desc,
    card.title asc;
end;
$$;

revoke all on function public.search_catalog(text, text, text, text) from public;
grant execute on function public.search_catalog(text, text, text, text)
  to anon, authenticated, service_role;

create function public.get_latest_app_release(p_package_name text)
returns table (
  app_id uuid,
  version_id uuid,
  package_name text,
  version_name text,
  version_code integer,
  changelog text,
  download_source public.apk_download_source,
  apk_path text,
  apk_url text,
  apk_size_bytes bigint,
  sha256 text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    app.id,
    version.id,
    app.package_name,
    version.version_name,
    version.version_code,
    version.changelog,
    version.download_source,
    version.apk_path,
    version.apk_url,
    version.apk_size_bytes,
    version.sha256
  from public.apps as app
  join public.app_versions as version on version.app_id = app.id
  where app.package_name = p_package_name
    and app.status = 'active'
    and version.status = 'published'
  order by version.version_code desc
  limit 1;
$$;

revoke all on function public.get_latest_app_release(text) from public;
grant execute on function public.get_latest_app_release(text)
  to anon, authenticated, service_role;
