create type public.apk_download_source as enum ('storage', 'external');

alter table public.app_versions
  alter column apk_path drop not null,
  add column download_source public.apk_download_source not null default 'storage',
  add column apk_url text,
  add constraint app_versions_source_consistency_check check (
    (
      download_source = 'storage'
      and apk_path is not null
      and apk_url is null
    )
    or (
      download_source = 'external'
      and apk_path is null
      and apk_url is not null
    )
  ),
  add constraint app_versions_external_url_check check (
    apk_url is null
    or (
      char_length(apk_url) between 1 and 2048
      and apk_url ~ '^https://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$'
    )
  );

create or replace view public.catalog_app_cards
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
  version.apk_url
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

create or replace function public.admin_publish_version(
  p_actor_id uuid,
  p_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.app_versions%rowtype;
begin
  perform private.require_admin_actor(p_actor_id);

  select *
  into target_version
  from public.app_versions
  where id = p_version_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Sürüm bulunamadı.';
  end if;

  if target_version.status = 'published' then
    return;
  end if;

  if target_version.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Yalnız taslak sürüm yayımlanabilir.';
  end if;

  if target_version.download_source = 'storage' and not exists (
    select 1
    from storage.objects
    where bucket_id = 'apks'
      and name = target_version.apk_path
      and coalesce((metadata->>'size')::bigint, 0) = target_version.apk_size_bytes
      and metadata->>'mimetype' in (
        'application/vnd.android.package-archive',
        'application/octet-stream'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Yayımlanacak APK doğrulanamadı.';
  end if;

  update public.app_versions
  set status = 'published',
      published_at = now()
  where id = p_version_id;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'version.publish',
    'version',
    p_version_id::text,
    jsonb_build_object(
      'new_status', 'published',
      'download_source', target_version.download_source
    )
  );
end;
$$;

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
    'app.create', 'app.update', 'app.archive',
    'category.create', 'category.update',
    'asset.upload',
    'screenshot.create', 'screenshot.update', 'screenshot.delete',
    'version.draft', 'upload.cleanup',
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
    when p_action = 'asset.upload' then 'asset'
    when p_action like 'screenshot.%' then 'screenshot'
    when p_action = 'version.draft' then 'version'
    when p_action = 'upload.cleanup' then 'upload'
    when p_action like 'user.%' then 'user'
  end;

  if p_target_type is distinct from expected_target_type then
    raise exception using errcode = 'P0001', message = 'İşlem ve hedef türü eşleşmiyor.';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Geçersiz audit metadata.';
  end if;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into safe_metadata
  from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as entry
  where entry.key = any (array[
    'old_status', 'new_status', 'status', 'version_code',
    'bucket', 'path', 'operation_id', 'partial',
    'download_source', 'hostname'
  ]);

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_actor_id, p_action, p_target_type, p_target_id, safe_metadata)
  returning id into audit_id;

  return audit_id;
end;
$$;
