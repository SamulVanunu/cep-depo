create function public.admin_set_app_publication_status(
  p_actor_id uuid,
  p_app_id uuid,
  p_status public.app_status
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_app public.apps%rowtype;
begin
  perform private.require_admin_actor(p_actor_id);

  select *
  into target_app
  from public.apps
  where id = p_app_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Uygulama bulunamadı.';
  end if;

  if p_status = 'active' and (
    target_app.icon_path is null
    or not exists (
      select 1
      from public.app_versions
      where app_id = p_app_id
        and status = 'published'
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Yayın için uygulama ikonu ve yayımlanmış sürüm zorunludur.';
  end if;

  update public.apps
  set status = p_status
  where id = p_app_id;

  insert into public.admin_audit_logs (
    actor_id, action, target_type, target_id, metadata
  ) values (
    p_actor_id,
    case p_status when 'active' then 'app.activate' else 'app.archive' end,
    'app',
    p_app_id::text,
    jsonb_build_object(
      'old_status', target_app.status,
      'new_status', p_status
    )
  );
end;
$$;

create function public.admin_delete_app_permanently(
  p_actor_id uuid,
  p_app_id uuid,
  p_confirmation_title text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_app public.apps%rowtype;
  managed_assets jsonb;
begin
  perform private.require_admin_actor(p_actor_id);

  select *
  into target_app
  from public.apps
  where id = p_app_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Uygulama bulunamadı.';
  end if;

  if p_confirmation_title is distinct from target_app.title then
    raise exception using errcode = 'P0001', message = 'Silme onayı uygulama adıyla eşleşmiyor.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('bucket', asset.bucket, 'path', asset.path)
    order by asset.bucket, asset.path
  ), '[]'::jsonb)
  into managed_assets
  from (
    select 'app-assets'::text as bucket, target_app.icon_path as path
    where target_app.icon_path ~ format(
      '^apps/%s/icons/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$',
      p_app_id
    )
    union all
    select 'app-assets', screenshot.path
    from public.app_screenshots as screenshot
    where screenshot.app_id = p_app_id
      and screenshot.path ~ format(
        '^apps/%s/screenshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$',
        p_app_id
      )
    union all
    select 'apks', version.apk_path
    from public.app_versions as version
    where version.app_id = p_app_id
      and version.download_source = 'storage'
      and version.apk_path = format('apps/%s/versions/%s.apk', version.app_id, version.id)
  ) as asset;

  with cleanup_candidates as (
    select
      asset->>'bucket' as bucket,
      asset->>'path' as path,
      ((regexp_match(
        asset->>'path',
        '/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(apk|png|jpg|webp)$'
      ))[1])::uuid as operation_id,
      case
        when asset->>'bucket' = 'apks' then 'apk'
        when asset->>'path' like '%/icons/%' then 'icon'
        else 'screenshot'
      end as target_type
    from jsonb_array_elements(managed_assets) as asset
  ), inserted_jobs as (
    insert into public.admin_asset_cleanup_jobs (
      bucket, path, operation_id, target_type
    )
    select bucket, path, operation_id, target_type
    from cleanup_candidates
    on conflict (bucket, path) where completed_at is null do nothing
    returning bucket, path, operation_id
  )
  insert into public.admin_audit_logs (
    actor_id, action, target_type, target_id, metadata
  )
  select
    p_actor_id,
    'asset.cleanup_pending',
    'asset',
    operation_id::text,
    jsonb_build_object(
      'bucket', bucket,
      'path', path,
      'operation_id', operation_id
    )
  from inserted_jobs;

  insert into public.admin_audit_logs (
    actor_id, action, target_type, target_id, metadata
  ) values (
    p_actor_id, 'app.delete', 'app', p_app_id::text, '{}'::jsonb
  );

  delete from public.apps
  where id = p_app_id;

  return managed_assets;
end;
$$;

revoke all on function public.admin_set_app_publication_status(uuid, uuid, public.app_status)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_app_publication_status(uuid, uuid, public.app_status)
  to service_role;

revoke all on function public.admin_delete_app_permanently(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_app_permanently(uuid, uuid, text)
  to service_role;
