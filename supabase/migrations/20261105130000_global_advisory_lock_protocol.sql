-- P3 — global advisory lock protocol for cleanup tombstones and catalog
-- references.
--
-- One key, (20261101, 1), now classifies every writer and reader. The lock is
-- transaction-level (pg_advisory_xact_lock*), so it ends at COMMIT/ROLLBACK
-- and never survives an RPC boundary. No function relies on the lock being
-- held by a previous call.
--
-- Inventory at the start of this migration:
--
--   existing shared users
--     private.assert_asset_path_not_retired()   reference guard triggers
--     private.app_versions_guard_draft()        draft re-entry guard
--   existing exclusive user
--     public.cleanup_asset_is_referenced()      the seal; its false answer
--                                               gates a Storage delete
--   separate key
--     public.admin_ensure_cleanup_audit()       hashtextextended(action,path)
--                                               dedupe only; unrelated key
--   lock-less tombstone writers
--     public.admin_publish_version_replacing_previous()
--     public.admin_delete_app_permanently()
--     public.cleanup_enqueue_orphan()
--   lock-less tombstone removers
--     public.cleanup_skip_job()                 skipped_at = now()
--     public.cleanup_requeue_job()              skipped_at = null
--   lock-less lifecycle writers (tombstone membership is unchanged)
--     public.cleanup_claim_jobs()
--     public.cleanup_start_job()
--     public.cleanup_release_job()
--     public.cleanup_complete_job()
--     public.cleanup_fail_job()
--     public.admin_requeue_cleanup_job()        calls the seal, so it must
--                                               already hold exclusive
--   lock-less reference reader
--     public.admin_set_app_publication_status() reads icon/published state
--   outside the protocol
--     private.cleanup_purge_job()               the manual controlled purge.
--                                               SECURITY DEFINER, granted to
--                                               no app role and not even to
--                                               service_role, so it is not a
--                                               parallel writer. If it ever
--                                               becomes a real RPC, it must
--                                               take exclusive here.
--
-- Classification:
--
--   exclusive — the function can add, remove, or keep-open a tombstone:
--     admin_publish_version_replacing_previous, admin_delete_app_permanently,
--     cleanup_enqueue_orphan, cleanup_skip_job, cleanup_requeue_job,
--     admin_requeue_cleanup_job, cleanup_asset_is_referenced.
--
--   shared — the function only reads references or moves a job whose
--   skipped_at state is unchanged:
--     cleanup_claim_jobs, cleanup_start_job, cleanup_release_job,
--     cleanup_complete_job, cleanup_fail_job,
--     admin_set_app_publication_status, and the two existing guard triggers.
--
-- The seal stays exclusive even though it only reads. Its answer authorises a
-- Storage DELETE, so a concurrent reference writer must not slip between the
-- check and the delete. It is a reader only by accident of syntax.
--
-- Ordering: every function takes the global lock before its first row lock.
-- That is the actual deadlock fix. Without it, session A can hold a row lock
-- and ask for shared while session B holds exclusive and waits for that row
-- (40P01). With it, the global lock is always the first waiter, so no cycle
-- can form.
--
-- Timeout: every acquisition first sets transaction-local
-- lock_timeout = '5s'. PostgreSQL raises SQLSTATE 55P03 (lock_not_available)
-- when the budget expires; nothing catches it, so the RPC fails closed and its
-- transaction writes nothing. A 5 s wait is short enough for the cleanup
-- worker budget and long enough for ordinary contention.
--
-- No shared -> exclusive upgrade: every transaction takes at most one mode.
-- admin_requeue_cleanup_job acquires exclusive at entry before it calls the
-- seal; the nested acquire is the same mode. Lifecycle readers never call the
-- seal. The worker calls the seal in a separate RPC transaction from its
-- claim/start calls, so the shared lock is already released.
--
-- P4 owns the catalog commit/rollback tombstone guard; this migration does not
-- touch commit_catalog_publish().

CREATE OR REPLACE FUNCTION public.admin_delete_app_permanently(p_actor_id uuid, p_app_id uuid, p_confirmation_title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_app public.apps%rowtype;
  managed_assets jsonb;
begin
  perform private.require_admin_actor(p_actor_id);

  -- Exclusive: this transaction queues tombstones for every managed asset.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

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
    on conflict (bucket, path) where completed_at is null and skipped_at is null do nothing
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
$function$
;
CREATE OR REPLACE FUNCTION public.admin_publish_version_replacing_previous(p_actor_id uuid, p_version_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_app_id uuid;
  target_app public.apps%rowtype;
  target_version public.app_versions%rowtype;
  previous_published_code integer;
  old_storage_paths text[];
begin
  perform private.require_admin_actor(p_actor_id);

  -- Non-locking identity lookup. It keeps the caller's original "version not
  -- found" answer when the app was deleted concurrently; the cascading delete
  -- removes the version row too, so the app lookup below is still the one that
  -- reports "app not found". No row lock is taken here.
  select app_id
  into target_app_id
  from public.app_versions
  where id = p_version_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'Sürüm bulunamadı.';
  end if;

  -- Exclusive: replacing a published version queues the old APK tombstones.
  -- Acquired before the first row lock below.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

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
    on conflict (bucket, path) where completed_at is null and skipped_at is null do nothing
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
$function$
;
CREATE OR REPLACE FUNCTION public.admin_requeue_cleanup_job(p_job_id uuid, p_actor_id uuid, p_expected_quarantined_at timestamp with time zone, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_target_type text;
  v_operation_id uuid;
  v_attempts integer;
  v_quarantined_at timestamptz;
  v_quarantine_reason text;
  v_completed_at timestamptz;
  v_skipped_at timestamptz;
  v_lease_expires_at timestamptz;
  v_storage_version text;
  v_live_version text;
  v_note text;
  v_match text[];
  v_asset_id uuid;
  v_updated integer;
begin
  perform private.require_admin_actor(p_actor_id);

  -- Exclusive at entry: this function calls the seal below. Taking shared here
  -- would be a shared -> exclusive upgrade in the same transaction.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  v_note := btrim(coalesce(p_note, ''));
  if char_length(v_note) < 10 or char_length(v_note) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'Yeniden kuyruğa alma açıklaması 10-500 karakter olmalıdır.';
  end if;

  select bucket, path, target_type, operation_id, attempts,
         quarantined_at, quarantine_reason, completed_at, skipped_at,
         lease_expires_at, storage_version
    into v_bucket, v_path, v_target_type, v_operation_id, v_attempts,
         v_quarantined_at, v_quarantine_reason, v_completed_at, v_skipped_at,
         v_lease_expires_at, v_storage_version
  from public.admin_asset_cleanup_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'İş bulunamadı.';
  end if;

  if v_completed_at is not null or v_skipped_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Tamamlanmış veya atlanmış iş yeniden kuyruğa alınamaz.';
  end if;

  if v_quarantined_at is null or v_quarantine_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Yalnızca karantinadaki işler yeniden kuyruğa alınabilir.';
  end if;

  if p_expected_quarantined_at is distinct from v_quarantined_at then
    raise exception using
      errcode = 'CLN08',
      message = 'Karantina zamanı eşleşmiyor; iş değişmiş olabilir.';
  end if;

  if v_lease_expires_at is not null and v_lease_expires_at > v_now then
    raise exception using
      errcode = 'CLN01',
      message = 'İş canlı bir lease altında; yeniden kuyruğa alınamaz.';
  end if;

  if v_bucket = 'apk-drafts' and v_target_type = 'apk_draft' then
    v_match := regexp_match(
      v_path,
      '^operations/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/source\.apk$'
    );
    v_asset_id := v_match[1]::uuid;
  elsif v_bucket = 'apks' and v_target_type = 'apk' then
    v_match := regexp_match(
      v_path,
      '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.apk$'
    );
    v_asset_id := v_match[1]::uuid;
  elsif v_bucket = 'app-assets' and v_target_type = 'icon' then
    v_match := regexp_match(
      v_path,
      '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/icons/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|webp)$'
    );
    v_asset_id := v_match[1]::uuid;
  elsif v_bucket = 'app-assets' and v_target_type = 'screenshot' then
    v_match := regexp_match(
      v_path,
      '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/screenshots/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|webp)$'
    );
    v_asset_id := v_match[1]::uuid;
  else
    raise exception using
      errcode = 'P0001',
      message = 'Geçersiz temizlik hedefi.';
  end if;

  if v_asset_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Geçersiz temizlik yolu.';
  end if;

  if v_operation_id is distinct from v_asset_id then
    raise exception using
      errcode = 'P0001',
      message = 'Saklanan operation_id dosya kimliğiyle eşleşmiyor.';
  end if;

  if public.cleanup_asset_is_referenced(v_bucket, v_path) then
    raise exception using
      errcode = 'CLN07',
      message = 'Dosya hâlâ bir kayıt tarafından kullanılıyor; yeniden kuyruğa alınamaz.';
  end if;

  -- Identity barrier. A present object must expose exactly the version pinned
  -- at enqueue. Anything else (no fingerprint, no live version, a replacement)
  -- is CLN10: the quarantine and the tombstone stay exactly as they are. A
  -- missing object is safe to requeue because the worker will find nothing to
  -- delete.
  select object.version
    into v_live_version
  from storage.objects as object
  where object.bucket_id = v_bucket
    and object.name = v_path
    and object.archived_at is null
  limit 1;

  if found then
    if v_storage_version is null
      or v_live_version is null
      or v_storage_version is distinct from v_live_version
    then
      raise exception using
        errcode = 'CLN10',
        message = 'Depodaki nesne kuyruğa alınan nesneyle aynı değil; elle inceleme gerekir.';
    end if;
  end if;

  -- skipped_at and completed_at are intentionally absent: quarantine never
  -- wrote them, and requeue must keep the path retired. The fingerprint stays
  -- pinned; a successful requeue retries the same physical object.
  update public.admin_asset_cleanup_jobs
     set quarantined_at = null,
         quarantine_reason = null,
         attempts = 0,
         next_attempt_at = v_now,
         worker_id = null,
         lease_expires_at = null,
         lease_token = null,
         started_at = null
   where id = p_job_id;
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception using
      errcode = 'CLN08',
      message = 'Karantina kaydı bu sırada değişti; iş yeniden yüklenmeli.';
  end if;

  insert into public.admin_asset_cleanup_events (
    job_id, bucket, path, attempt, outcome, error_code, error_detail, worker_id
  ) values (
    p_job_id, v_bucket, v_path, 0, 'requeued',
    v_quarantine_reason, v_note, null
  );

  perform public.admin_record_external_action(
    p_actor_id,
    'cleanup.requeue',
    'cleanup_job',
    p_job_id::text,
    jsonb_build_object(
      'job_id', p_job_id::text,
      'bucket', v_bucket,
      'path', v_path,
      'quarantine_reason', v_quarantine_reason,
      'note', v_note,
      'previous_attempts', v_attempts
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_set_app_publication_status(p_actor_id uuid, p_app_id uuid, p_status app_status)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  target_app public.apps%rowtype;
begin
  perform private.require_admin_actor(p_actor_id);

  -- Shared: this only reads the icon/published-version references that decide
  -- whether activation is allowed; it never changes the tombstone set.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

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
$function$
;
CREATE OR REPLACE FUNCTION private.app_versions_guard_draft()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'draft' then
    perform pg_catalog.set_config('lock_timeout', '5s', true);
    perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

    if exists (
      select 1
      from public.admin_audit_logs as audit
      join public.admin_asset_cleanup_jobs as job
        on job.bucket = 'apk-drafts'
       and job.path = audit.metadata->>'path'
      where audit.action = 'version.draft'
        and audit.target_id = new.id::text
        and job.skipped_at is null
    ) then
      raise exception using
        errcode = 'CLN02',
        message = 'Bu dosya silinmek üzere kuyruğa alınmış.';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.assert_asset_path_not_retired(p_bucket text, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Taken before the check and held until the caller commits, so the seal
  -- cannot pass between the check and the reference write.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

  -- Separate statement: under Read Committed this reads a fresh snapshot and
  -- therefore sees a job committed after the lock was acquired.
  if exists (
    select 1
    from public.admin_asset_cleanup_jobs
    where bucket = p_bucket
      and path = p_path
      and skipped_at is null
  ) then
    raise exception using
      errcode = 'CLN02',
      message = 'Bu dosya silinmek üzere kuyruğa alınmış.';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_asset_is_referenced(p_bucket text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_app_id uuid;
  v_version_id uuid;
  v_row_app_id uuid;
  v_match text[];
  v_result boolean;
begin
  -- Seal before any read. Released when this transaction ends.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  if p_bucket = 'apks' then
    -- Same pattern as app_versions_apk_path_check.
    if p_path !~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;

    v_match := regexp_match(
      p_path,
      '^apps/([0-9a-f-]{36})/versions/([0-9a-f-]{36})\.apk$'
    );
    v_app_id := v_match[1]::uuid;
    v_version_id := v_match[2]::uuid;

    select app_id into v_row_app_id
    from public.app_versions
    where id = v_version_id;

    if v_row_app_id is not null and v_row_app_id <> v_app_id then
      raise exception using errcode = 'P0001', message = 'Dosya sahipliği uyuşmuyor.';
    end if;

    select exists (
      select 1 from public.app_versions where apk_path = p_path
    ) into v_result;

  elsif p_bucket = 'app-assets' then
    if p_path !~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;

    v_match := regexp_match(p_path, '^apps/([0-9a-f-]{36})/(icons|screenshots)/');
    v_app_id := v_match[1]::uuid;

    if v_match[2] = 'icons' then
      select id into v_row_app_id from public.apps where icon_path = p_path;
    else
      select app_id into v_row_app_id from public.app_screenshots where path = p_path;
    end if;

    if v_row_app_id is not null and v_row_app_id <> v_app_id then
      raise exception using errcode = 'P0001', message = 'Dosya sahipliği uyuşmuyor.';
    end if;

    select exists (
      select 1 from public.apps where icon_path = p_path
      union all
      select 1 from public.app_screenshots where path = p_path
    ) into v_result;

  elsif p_bucket = 'apk-drafts' then
    if p_path !~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;

    select exists (
      select 1
      from public.admin_audit_logs as audit
      join public.app_versions as version
        on version.id::text = audit.target_id
      where audit.action = 'version.draft'
        and audit.metadata->>'path' = p_path
        and version.status = 'draft'
    ) into v_result;

  else
    raise exception using errcode = 'P0001', message = 'Geçersiz bucket.';
  end if;

  return coalesce(v_result, false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_claim_jobs(p_worker_id text, p_limit integer DEFAULT 25, p_lease_seconds integer DEFAULT 120)
 RETURNS TABLE(job_id uuid, bucket text, path text, target_type text, operation_id uuid, attempts integer, lease_expires_at timestamp with time zone, lease_token uuid, storage_version text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
begin
  if p_worker_id is null or p_worker_id !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
    raise exception using errcode = 'P0001', message = 'Geçersiz worker kimliği.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode = 'P0001', message = 'Geçersiz parti boyutu.';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception using errcode = 'P0001', message = 'Geçersiz lease süresi.';
  end if;

  -- Shared: claiming leases rows and may quarantine, but it never changes
  -- skipped_at, so the tombstone set is unchanged.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

  with stranded as (
    update public.admin_asset_cleanup_jobs as j
       set quarantined_at = v_now,
           quarantine_reason = 'attempts_exhausted',
           worker_id = null,
           lease_expires_at = null,
           lease_token = null
     where j.completed_at is null
       and j.skipped_at is null
       and j.quarantined_at is null
       and j.attempts >= 5
       and (j.lease_expires_at is null or j.lease_expires_at <= v_now)
     returning j.id, j.bucket, j.path, j.attempts
  )
  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, worker_id)
  select s.id, s.bucket, s.path, s.attempts, 'quarantined', null
  from stranded as s;

  return query
  with candidates as (
    select j.id
    from public.admin_asset_cleanup_jobs as j
    where j.completed_at is null
      and j.skipped_at is null
      and j.quarantined_at is null
      and j.attempts < 5
      and j.next_attempt_at <= v_now
      and (j.lease_expires_at is null or j.lease_expires_at <= v_now)
    order by j.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.admin_asset_cleanup_jobs as j
       set worker_id = p_worker_id,
           lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid(),
           started_at = null,
           next_attempt_at = v_now + private.cleanup_backoff(j.attempts + 1)
     from candidates as c
    where j.id = c.id
    returning j.id, j.bucket, j.path, j.target_type,
              j.operation_id, j.attempts, j.lease_expires_at, j.lease_token,
              j.storage_version
  ), logged as (
    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, worker_id)
    select c.id, c.bucket, c.path, c.attempts + 1, 'claimed', p_worker_id
    from claimed as c
  )
  select c.id, c.bucket, c.path, c.target_type,
         c.operation_id, c.attempts, c.lease_expires_at, c.lease_token,
         c.storage_version
  from claimed as c;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_complete_job(p_job_id uuid, p_worker_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_attempts integer;
begin
  -- Shared: completion keeps skipped_at null, so the tombstone stays.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

  update public.admin_asset_cleanup_jobs
     set completed_at = v_now,
         lease_expires_at = null,
         lease_token = null,
         attempts = case
           when started_at is null and attempts < 5 then attempts + 1
           else attempts
         end,
         last_attempt_at = case
           when started_at is null then v_now
           else last_attempt_at
         end,
         started_at = coalesce(started_at, v_now)
   where id = p_job_id
     and completed_at is null
     and skipped_at is null
     and quarantined_at is null
     and worker_id = p_worker_id
     and lease_expires_at > v_now
  returning bucket, path, attempts
       into v_bucket, v_path, v_attempts;

  if not found then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bu worker''ın canlı lease''i altında değil.';
  end if;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, worker_id)
  values (p_job_id, v_bucket, v_path, v_attempts, 'completed', p_worker_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_enqueue_orphan(p_bucket text, p_path text, p_target_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_operation_id uuid;
  v_id uuid;
begin
  if p_bucket is null or p_path is null or p_target_type is null then
    raise exception using errcode = 'P0001', message = 'Geçersiz kuyruk hedefi.';
  end if;

  -- Same shape as admin_asset_cleanup_jobs_managed_path_check.
  if p_bucket = 'apk-drafts' and p_target_type = 'apk_draft' then
    if p_path !~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;
    v_operation_id := (regexp_match(
      p_path,
      '^operations/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/source\.apk$'
    ))[1]::uuid;
  elsif p_bucket = 'apks' and p_target_type = 'apk' then
    if p_path !~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;
    v_operation_id := (regexp_match(
      p_path,
      '/versions/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.apk$'
    ))[1]::uuid;
  elsif p_bucket = 'app-assets' and p_target_type = 'icon' then
    if p_path !~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/icons/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;
    v_operation_id := (regexp_match(
      p_path,
      '/icons/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|webp)$'
    ))[1]::uuid;
  elsif p_bucket = 'app-assets' and p_target_type = 'screenshot' then
    if p_path !~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/screenshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;
    v_operation_id := (regexp_match(
      p_path,
      '/screenshots/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|webp)$'
    ))[1]::uuid;
  else
    raise exception using errcode = 'P0001', message = 'Geçersiz bucket veya hedef tipi.';
  end if;

  -- Exclusive: the insert is the tombstone that closes this path.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  insert into public.admin_asset_cleanup_jobs (
    bucket, path, operation_id, target_type
  )
  values (p_bucket, p_path, v_operation_id, p_target_type)
  on conflict (bucket, path) where completed_at is null and skipped_at is null
  do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome)
  values (v_id, p_bucket, p_path, 0, 'orphan_enqueued');

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_fail_job(p_job_id uuid, p_worker_id text, p_error text)
 RETURNS TABLE(attempts integer, next_attempt_at timestamp with time zone, quarantined boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_attempts integer;
  v_started_at timestamptz;
  v_next timestamptz;
  v_error text;
  v_auto_started boolean := false;
begin
  -- Shared: failure/quarantine keeps skipped_at null, so the tombstone stays.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

  -- Redact URL query strings, then clip. The column check also caps at 500.
  v_error := regexp_replace(
    coalesce(p_error, ''),
    '(https?://[^?\s#]*)\?[^#\s]*',
    '\1?[redacted]',
    'g'
  );
  v_error := left(v_error, 500);

  select j.bucket, j.path, j.attempts, j.started_at, j.next_attempt_at
    into v_bucket, v_path, v_attempts, v_started_at, v_next
  from public.admin_asset_cleanup_jobs as j
  where j.id = p_job_id
    and j.completed_at is null
    and j.skipped_at is null
    and j.quarantined_at is null
    and j.worker_id = p_worker_id
    and j.lease_expires_at > v_now
  for update;

  if not found then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bu worker''ın canlı lease''i altında değil.';
  end if;

  -- A caller that did not call start still made a real attempt. Charge it
  -- exactly once and record it, so a later quiescence check sees the start.
  if v_started_at is null then
    v_auto_started := true;
    if v_attempts < 5 then
      v_attempts := v_attempts + 1;
    end if;
    v_started_at := v_now;
  end if;

  update public.admin_asset_cleanup_jobs
     set last_error = v_error,
         last_error_at = v_now,
         lease_expires_at = null,
         lease_token = null,
         worker_id = null,
         attempts = v_attempts,
         last_attempt_at = case
           when v_auto_started then v_now
           else last_attempt_at
         end,
         started_at = v_started_at
   where id = p_job_id;

  if v_auto_started then
    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, worker_id)
    values (p_job_id, v_bucket, v_path, v_attempts, 'started', p_worker_id);
  end if;

  if v_attempts >= 5 then
    update public.admin_asset_cleanup_jobs
       set quarantined_at = v_now,
           quarantine_reason = 'attempts_exhausted'
     where id = p_job_id;

    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, error_detail, worker_id)
    values (p_job_id, v_bucket, v_path, v_attempts,
            'quarantined', v_error, p_worker_id);

    return query select v_attempts, v_next, true;
    return;
  end if;

  v_next := v_now + private.cleanup_backoff(v_attempts);

  update public.admin_asset_cleanup_jobs
     set next_attempt_at = v_next
   where id = p_job_id;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, error_detail, worker_id)
  values (p_job_id, v_bucket, v_path, v_attempts, 'failed', v_error, p_worker_id);

  return query select v_attempts, v_next, false;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_release_job(p_job_id uuid, p_worker_id text, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_attempts integer;
  v_started_at timestamptz;
  v_terminal boolean;
  v_owner text;
  v_token uuid;
  v_lease_expires_at timestamptz;
begin
  if p_job_id is null or p_worker_id is null or p_lease_token is null then
    raise exception using errcode = 'P0001', message = 'Geçersiz iş kimliği.';
  end if;

  -- Shared: releasing a claim never touches skipped_at.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

  select j.bucket, j.path, j.attempts, j.started_at,
         (j.completed_at is not null or j.skipped_at is not null
          or j.quarantined_at is not null),
         j.worker_id, j.lease_token, j.lease_expires_at
    into v_bucket, v_path, v_attempts, v_started_at, v_terminal,
         v_owner, v_token, v_lease_expires_at
  from public.admin_asset_cleanup_jobs as j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bulunamadı veya bu worker''a ait değil.';
  end if;

  -- Terminal rows are handled before the token check so complete/fail/skip
  -- can clear the token without turning a late release into a tombstone edit.
  if v_terminal then
    raise exception using
      errcode = 'CLN09',
      message = 'İş terminal durumda; serbest bırakılamaz.';
  end if;

  if v_owner is distinct from p_worker_id
    or v_token is distinct from p_lease_token
    or v_lease_expires_at is null
    or v_lease_expires_at <= v_now
  then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bu worker''ın canlı lease''i altında değil.';
  end if;

  -- Once a Storage call may have begun, only fail/complete/skip may end the
  -- claim. Releasing it would hide a possible in-flight remove.
  if v_started_at is not null then
    raise exception using
      errcode = 'CLN09',
      message = 'İş işlenmeye başlamış; serbest bırakılamaz.';
  end if;

  update public.admin_asset_cleanup_jobs
     set worker_id = null,
         lease_expires_at = null,
         lease_token = null,
         started_at = null,
         next_attempt_at = v_now
   where id = p_job_id;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, worker_id)
  values (p_job_id, v_bucket, v_path, v_attempts, 'released', p_worker_id);

  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_requeue_job(p_job_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
begin
  -- Exclusive: clearing skipped_at reopens the retired path.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  if exists (
    select 1 from public.admin_asset_cleanup_jobs
    where id = p_job_id and completed_at is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Tamamlanmış iş yeniden kuyruğa alınamaz.';
  end if;

  if exists (
    select 1 from public.admin_asset_cleanup_jobs
    where id = p_job_id
      and worker_id is not null
      and lease_expires_at > v_now
  ) then
    raise exception using
      errcode = 'CLN01',
      message = 'İş canlı bir lease altında; yeniden kuyruğa alınamaz.';
  end if;

  update public.admin_asset_cleanup_jobs
     set skipped_at = null,
         skip_reason = null,
         quarantined_at = null,
         quarantine_reason = null,
         attempts = 0,
         next_attempt_at = v_now,
         worker_id = null,
         lease_expires_at = null,
         lease_token = null,
         started_at = null
   where id = p_job_id
     and completed_at is null
     and (lease_expires_at is null or lease_expires_at <= v_now)
  returning bucket, path
       into v_bucket, v_path;

  if not found then
    raise exception using errcode = 'P0001', message = 'İş bulunamadı.';
  end if;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, error_detail)
  values (
    p_job_id, v_bucket, v_path, 0, 'requeued',
    nullif(left(coalesce(p_reason, ''), 500), '')
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_skip_job(p_job_id uuid, p_worker_id text, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_attempts integer;
  v_started_at timestamptz;
  v_started integer;
  v_quarantine_reason text;
  v_auto_started boolean := false;
begin
  if p_reason is null
    or p_reason not in ('referenced', 'ownership_mismatch', 'race_detected')
  then
    raise exception using errcode = 'P0001', message = 'Geçersiz atlama nedeni.';
  end if;

  -- Exclusive: the skip/quarantine decision can clear or preserve skipped_at,
  -- so it mutates the tombstone set.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  select j.bucket, j.path, j.attempts, j.started_at
    into v_bucket, v_path, v_attempts, v_started_at
  from public.admin_asset_cleanup_jobs as j
  where j.id = p_job_id
    and j.completed_at is null
    and j.skipped_at is null
    and j.quarantined_at is null
    and j.worker_id = p_worker_id
    and j.lease_expires_at > v_now
  for update;

  if not found then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bu worker''ın canlı lease''i altında değil.';
  end if;

  if v_started_at is null then
    v_auto_started := true;
    if v_attempts < 5 then
      v_attempts := v_attempts + 1;
    end if;
    v_started_at := v_now;

    update public.admin_asset_cleanup_jobs
       set attempts = v_attempts,
           last_attempt_at = v_now,
           started_at = v_started_at
     where id = p_job_id;

    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, worker_id)
    values (p_job_id, v_bucket, v_path, v_attempts, 'started', p_worker_id);
  end if;

  -- Only a prior `started` event proves that an earlier worker may have begun
  -- a remove. A claim that was released before starting never did.
  select count(*) into v_started
    from public.admin_asset_cleanup_events
   where job_id = p_job_id
     and outcome = 'started';

  if p_reason = 'race_detected' then
    v_quarantine_reason := 'race_detected';
  elsif p_reason = 'referenced' and v_started >= 2 then
    v_quarantine_reason := 'quiescence_unproven';
  end if;

  if v_quarantine_reason is not null then
    update public.admin_asset_cleanup_jobs
       set quarantined_at = v_now,
           quarantine_reason = v_quarantine_reason,
           lease_expires_at = null,
           lease_token = null
     where id = p_job_id;

    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, error_code, worker_id)
    values (p_job_id, v_bucket, v_path, v_attempts,
            'quarantined', v_quarantine_reason, p_worker_id);

    if p_reason = 'race_detected' then
      insert into public.admin_asset_cleanup_events
        (job_id, bucket, path, attempt, outcome, error_code, worker_id)
      values (p_job_id, v_bucket, v_path, v_attempts,
              'race_detected', p_reason, p_worker_id);
    end if;

    return 'quarantined';
  end if;

  update public.admin_asset_cleanup_jobs
     set skipped_at = v_now,
         skip_reason = p_reason,
         lease_expires_at = null,
         lease_token = null
   where id = p_job_id;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, error_code, worker_id)
  values (p_job_id, v_bucket, v_path, v_attempts, 'skipped', p_reason, p_worker_id);

  return 'skipped';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_start_job(p_job_id uuid, p_worker_id text, p_lease_token uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_attempts integer;
  v_started_at timestamptz;
  v_terminal boolean;
  v_owner text;
  v_token uuid;
  v_lease_expires_at timestamptz;
  v_bucket text;
  v_path text;
begin
  if p_job_id is null or p_worker_id is null or p_lease_token is null then
    raise exception using errcode = 'P0001', message = 'Geçersiz iş kimliği.';
  end if;

  -- Shared: starting an attempt never touches skipped_at.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock_shared(20261101, 1);

  select j.attempts, j.started_at,
         (j.completed_at is not null or j.skipped_at is not null
          or j.quarantined_at is not null),
         j.worker_id, j.lease_token, j.lease_expires_at, j.bucket, j.path
    into v_attempts, v_started_at, v_terminal,
         v_owner, v_token, v_lease_expires_at, v_bucket, v_path
  from public.admin_asset_cleanup_jobs as j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bulunamadı veya bu worker''a ait değil.';
  end if;

  if v_terminal then
    raise exception using
      errcode = 'CLN09',
      message = 'İş terminal durumda; başlatılamaz.';
  end if;

  if v_owner is distinct from p_worker_id
    or v_token is distinct from p_lease_token
    or v_lease_expires_at is null
    or v_lease_expires_at <= v_now
  then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bu worker''ın canlı lease''i altında değil.';
  end if;

  -- A retried start after a client timeout must not spend a second attempt.
  if v_started_at is not null then
    return v_attempts;
  end if;

  if v_attempts >= 5 then
    raise exception using
      errcode = 'CLN09',
      message = 'Deneme bütçesi tükenmiş.';
  end if;

  update public.admin_asset_cleanup_jobs
     set attempts = v_attempts + 1,
         last_attempt_at = v_now,
         started_at = v_now
   where id = p_job_id;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, worker_id)
  values (p_job_id, v_bucket, v_path, v_attempts + 1, 'started', p_worker_id);

  return v_attempts + 1;
end;
$function$
;
