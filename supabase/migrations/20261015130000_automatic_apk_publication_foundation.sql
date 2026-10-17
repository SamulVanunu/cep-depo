alter table public.apps
  add column package_name text,
  add constraint apps_package_name_check check (
    package_name is null
    or (
      package_name = btrim(package_name)
      and char_length(package_name) between 3 and 255
      and package_name ~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
    )
  ) not valid;

alter table public.apps validate constraint apps_package_name_check;

alter table public.app_versions
  add column package_name text,
  add constraint app_versions_package_name_check check (
    package_name is null
    or (
      package_name = btrim(package_name)
      and char_length(package_name) between 3 and 255
      and package_name ~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
    )
  ) not valid;

alter table public.app_versions validate constraint app_versions_package_name_check;

create table public.admin_asset_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  operation_id uuid not null,
  target_type text not null check (
    target_type in ('apk_draft', 'apk', 'icon', 'screenshot')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  last_error_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_asset_cleanup_jobs_managed_path_check check (
    (
      bucket = 'apk-drafts'
      and target_type = 'apk_draft'
      and path ~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$'
    )
    or (
      bucket = 'apks'
      and target_type = 'apk'
      and path ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
    )
    or (
      bucket = 'app-assets'
      and target_type = 'icon'
      and path ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/icons/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    )
    or (
      bucket = 'app-assets'
      and target_type = 'screenshot'
      and path ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/screenshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    )
  )
);

create unique index admin_asset_cleanup_jobs_pending_object_idx
  on public.admin_asset_cleanup_jobs (bucket, path)
  where completed_at is null;

create index admin_asset_cleanup_jobs_pending_created_idx
  on public.admin_asset_cleanup_jobs (created_at)
  where completed_at is null;

alter table public.admin_asset_cleanup_jobs enable row level security;

create trigger admin_asset_cleanup_jobs_set_updated_at
before update on public.admin_asset_cleanup_jobs
for each row
execute function private.set_community_updated_at();

revoke all on table public.admin_asset_cleanup_jobs
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.admin_asset_cleanup_jobs
  to service_role;

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_action_check,
  add constraint admin_audit_logs_action_check check (
    action = any (array[
      'app.create', 'app.update', 'app.archive', 'app.activate', 'app.delete',
      'category.create', 'category.update',
      'asset.upload', 'asset.cleanup_pending',
      'screenshot.create', 'screenshot.update', 'screenshot.delete',
      'version.draft', 'version.publish', 'version.withdraw', 'version.replace',
      'upload.cleanup',
      'review.hide', 'review.show', 'review.delete',
      'report.resolve', 'report.dismiss',
      'user.suspend', 'user.activate', 'user.delete', 'user.recovery_request'
    ])
  );

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
    else false
  end;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_actor_id, p_action, p_target_type, p_target_id, safe_metadata)
  returning id into audit_id;

  return audit_id;
end;
$$;
