create function public.admin_publish_version_replacing_previous(
  p_actor_id uuid,
  p_version_id uuid
)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_app_id uuid;
  target_app public.apps%rowtype;
  target_version public.app_versions%rowtype;
  previous_published_code integer;
  old_storage_paths text[];
begin
  perform private.require_admin_actor(p_actor_id);

  select app_id
  into target_app_id
  from public.app_versions
  where id = p_version_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'Sürüm bulunamadı.';
  end if;

  select *
  into target_app
  from public.apps
  where id = target_app_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Uygulama bulunamadı.';
  end if;

  perform id
  from public.app_versions
  where app_id = target_app_id
  order by id
  for update;

  select *
  into target_version
  from public.app_versions
  where id = p_version_id
    and app_id = target_app_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'Sürüm bulunamadı.';
  end if;

  if target_version.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Yalnız taslak sürüm yayımlanabilir.';
  end if;

  if target_version.package_name is null
    or target_version.package_name !~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
  then
    raise exception using errcode = 'P0001', message = 'APK paket kimliği zorunludur.';
  end if;

  if target_version.version_code <= 0 then
    raise exception using errcode = 'P0001', message = 'Geçerli bir sürüm kodu zorunludur.';
  end if;

  if target_version.apk_size_bytes <= 0
    or target_version.sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = 'P0001', message = 'APK kaynak bilgileri geçerli değil.';
  end if;

  if target_version.download_source = 'storage' then
    if target_version.apk_url is not null
      or target_version.apk_path is distinct from format(
        'apps/%s/versions/%s.apk', target_app_id, p_version_id
      )
      or not exists (
        select 1
        from storage.objects
        where bucket_id = 'apks'
          and name = target_version.apk_path
          and metadata->>'size' ~ '^[0-9]+$'
          and (metadata->>'size')::numeric = target_version.apk_size_bytes
          and metadata->>'mimetype' in (
            'application/vnd.android.package-archive',
            'application/octet-stream'
          )
      )
    then
      raise exception using errcode = 'P0001', message = 'Yayımlanacak APK doğrulanamadı.';
    end if;
  elsif target_version.download_source = 'external' then
    if target_version.apk_path is not null
      or target_version.apk_url is null
      or target_version.apk_url !~ '^https://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$'
    then
      raise exception using errcode = 'P0001', message = 'APK kaynak bilgileri geçerli değil.';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'APK kaynak bilgileri geçerli değil.';
  end if;

  if target_app.package_name is not null
    and target_app.package_name <> target_version.package_name
  then
    raise exception using errcode = 'P0001', message = 'APK paket kimliği uygulamayla eşleşmiyor.';
  end if;

  select max(version_code)
  into previous_published_code
  from public.app_versions
  where app_id = target_app_id
    and status = 'published';

  if previous_published_code is null and target_app.icon_path is null then
    raise exception using errcode = 'P0001', message = 'İlk yayın için uygulama ikonu zorunludur.';
  end if;

  if previous_published_code is not null
    and target_version.version_code <= previous_published_code
  then
    raise exception using errcode = 'P0001', message = 'Sürüm kodu mevcut yayından büyük olmalıdır.';
  end if;

  select coalesce(array_agg(apk_path order by id), array[]::text[])
  into old_storage_paths
  from public.app_versions
  where app_id = target_app_id
    and id <> p_version_id
    and download_source = 'storage'
    and apk_path = format('apps/%s/versions/%s.apk', app_id, id);

  with inserted_jobs as (
    insert into public.admin_asset_cleanup_jobs (
      bucket, path, operation_id, target_type
    )
    select 'apks', apk_path, id, 'apk'
    from public.app_versions
    where app_id = target_app_id
      and id <> p_version_id
      and download_source = 'storage'
      and apk_path = format('apps/%s/versions/%s.apk', app_id, id)
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

  update public.app_versions
  set status = 'published',
      published_at = now()
  where id = p_version_id;

  update public.apps
  set status = 'active',
      package_name = coalesce(package_name, target_version.package_name)
  where id = target_app_id;

  insert into public.admin_audit_logs (
    actor_id, action, target_type, target_id, metadata
  ) values (
    p_actor_id,
    'version.publish',
    'version',
    p_version_id::text,
    jsonb_build_object(
      'new_status', 'published',
      'download_source', target_version.download_source
    )
  );

  if target_app.status = 'archived' then
    insert into public.admin_audit_logs (
      actor_id, action, target_type, target_id, metadata
    ) values (
      p_actor_id,
      'app.activate',
      'app',
      target_app_id::text,
      jsonb_build_object('old_status', 'archived', 'new_status', 'active')
    );
  end if;

  insert into public.admin_audit_logs (
    actor_id, action, target_type, target_id, metadata
  ) values (
    p_actor_id,
    'version.replace',
    'version',
    p_version_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'old_version_code', previous_published_code,
      'new_version_code', target_version.version_code,
      'download_source', target_version.download_source
    ))
  );

  delete from public.app_versions
  where app_id = target_app_id
    and id <> p_version_id;

  return old_storage_paths;
end;
$$;

revoke all on function public.admin_publish_version_replacing_previous(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_publish_version_replacing_previous(uuid, uuid)
  to service_role;
