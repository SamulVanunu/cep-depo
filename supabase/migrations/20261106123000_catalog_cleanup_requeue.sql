-- P8 — admin requeue learns the `catalog` bucket.
--
-- A catalog job is a tombstone for one immutable release document, so the
-- requeue must keep every asset guarantee and add exactly one catalog rule:
--
--   * the stored `catalog_release_id` must describe the path, and the asset
--     UUID identity check (`operation_id` vs path) does not apply because a
--     catalog row has no operation id;
--   * the exclusive advisory lock still comes first, before the row lock, so a
--     seal caller cannot deadlock against this writer;
--   * the reference seal still decides CLN07. For `catalog` it reads the
--     publish ledger, so a retained release or an open reconciliation refuses
--     the requeue exactly like a live asset reference;
--   * the Storage fingerprint barrier still decides CLN10: a replaced object
--     is manual inspection, a missing object is safe to retry;
--   * `skipped_at` / `completed_at` are still untouched, so the path stays
--     retired through the requeue.
--
-- The audit delegate is extended in the same additive way. `cleanup.requeue`
-- keeps its action and `cleanup_job` target type; only the accepted bucket and
-- path vocabulary grows, and a catalog row must also carry the `release_id`
-- that the path segment names. Without this the requeue would roll back on
-- `Geçersiz cleanup requeue audit metadata.` and no catalog job could ever be
-- retried.

-- ---------------------------------------------------------------------------
-- 1. Audit delegate: additive catalog vocabulary for cleanup.requeue
-- ---------------------------------------------------------------------------

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
    'user.delete', 'user.recovery_request',
    'catalog.publish', 'catalog.rollback', 'catalog.reconcile', 'catalog.gc',
    'cleanup.requeue'
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
    when p_action like 'catalog.%' then 'catalog_release'
    when p_action = 'cleanup.requeue' then 'cleanup_job'
  end;

  if p_target_type is distinct from expected_target_type then
    raise exception using errcode = 'P0001', message = 'İşlem ve hedef türü eşleşmiyor.';
  end if;

  if p_action in ('app.delete', 'version.replace', 'asset.cleanup_pending', 'cleanup.requeue')
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

  -- A requeue audit row is self-describing. The job id is both the target and a
  -- metadata field; the note and previous attempt count must be present so the
  -- history can answer "who requeued what, why and from which attempt" without
  -- joining a mutable queue row. A catalog row additionally carries the
  -- release id, and it must name the same release as the path segment.
  if p_action = 'cleanup.requeue' and not coalesce((
    jsonb_typeof(p_metadata->'job_id') = 'string'
    and p_metadata->>'job_id' = p_target_id
    and p_metadata->>'job_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(p_metadata->'bucket') = 'string'
    and jsonb_typeof(p_metadata->'path') = 'string'
    and jsonb_typeof(p_metadata->'quarantine_reason') = 'string'
    and p_metadata->>'quarantine_reason' in (
      'attempts_exhausted', 'race_detected', 'quiescence_unproven'
    )
    and jsonb_typeof(p_metadata->'note') = 'string'
    and char_length(btrim(p_metadata->>'note')) between 10 and 500
    and jsonb_typeof(p_metadata->'previous_attempts') = 'number'
    and p_metadata->>'previous_attempts' ~ '^[0-9]+$'
    and (p_metadata->>'previous_attempts')::numeric between 0 and 5
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
      or (
        p_metadata->>'bucket' = 'catalog'
        and jsonb_typeof(p_metadata->'release_id') = 'string'
        and p_metadata->>'release_id' ~ '^[A-Za-z0-9_-]{8,64}$'
        and p_metadata->>'path' ~ '^releases/[A-Za-z0-9_-]{8,64}/(apps|categories)\.json$'
        and split_part(p_metadata->>'path', '/', 2) = p_metadata->>'release_id'
      )
    )
  ), false) then
    raise exception using errcode = 'P0001', message = 'Geçersiz cleanup requeue audit metadata.';
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
      and entry.value #>> '{}' = any (array['apk-drafts', 'apks', 'app-assets', 'catalog'])
    when entry.key = 'path' then
      jsonb_typeof(entry.value) = 'string'
      and (
        entry.value #>> '{}' ~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$'
        or entry.value #>> '{}' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
        or entry.value #>> '{}' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
        or entry.value #>> '{}' ~ '^releases/[A-Za-z0-9_-]{8,64}/(apps|categories)\.json$'
      )
    when entry.key = 'operation_id' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when entry.key = 'job_id' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when entry.key = 'quarantine_reason' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' in (
        'attempts_exhausted', 'race_detected', 'quiescence_unproven'
      )
    when entry.key = 'note' then
      jsonb_typeof(entry.value) = 'string'
      and char_length(btrim(entry.value #>> '{}')) between 10 and 500
    when entry.key = 'previous_attempts' then
      jsonb_typeof(entry.value) = 'number'
      and entry.value #>> '{}' ~ '^[0-9]+$'
      and (entry.value #>> '{}')::numeric between 0 and 5
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
    when entry.key = 'release_id' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' ~ '^[A-Za-z0-9_-]{8,64}$'
    when entry.key = 'generation' then
      jsonb_typeof(entry.value) = 'number'
      and entry.value #>> '{}' ~ '^[0-9]+$'
      and char_length(entry.value #>> '{}') <= 19
      and (entry.value #>> '{}')::bigint >= 0
    else false
  end;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_actor_id, p_action, p_target_type, p_target_id, safe_metadata)
  returning id into audit_id;

  return audit_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Requeue: catalog identity + unchanged seal and fingerprint barriers
-- ---------------------------------------------------------------------------

create or replace function public.admin_requeue_cleanup_job(
  p_job_id uuid,
  p_actor_id uuid,
  p_expected_quarantined_at timestamptz,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_target_type text;
  v_operation_id uuid;
  v_catalog_release_id text;
  v_is_catalog boolean := false;
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

  select bucket, path, target_type, operation_id, catalog_release_id,
         attempts, quarantined_at, quarantine_reason, completed_at, skipped_at,
         lease_expires_at, storage_version
    into v_bucket, v_path, v_target_type, v_operation_id, v_catalog_release_id,
         v_attempts, v_quarantined_at, v_quarantine_reason,
         v_completed_at, v_skipped_at, v_lease_expires_at, v_storage_version
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

  if v_bucket = 'catalog' and v_target_type = 'catalog_document' then
    -- A catalog row has no operation id. Its identity is the release id, and
    -- the release id must name the path segment that will be deleted.
    if v_catalog_release_id is null
      or v_catalog_release_id !~ '^[A-Za-z0-9_-]{8,64}$'
      or v_path !~ '^releases/[A-Za-z0-9_-]{8,64}/(apps|categories)\.json$'
      or split_part(v_path, '/', 2) is distinct from v_catalog_release_id
    then
      raise exception using
        errcode = 'P0001',
        message = 'Geçersiz katalog temizlik hedefi.';
    end if;
    v_is_catalog := true;
  elsif v_bucket = 'apk-drafts' and v_target_type = 'apk_draft' then
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

  if not v_is_catalog then
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
  -- delete. The rule is bucket-agnostic, so it covers catalog documents too.
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
  -- pinned; a successful requeue retries the same physical object. The catalog
  -- release identity is equally untouched.
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
    || case
         when v_catalog_release_id is not null then
           jsonb_build_object('release_id', v_catalog_release_id)
         else '{}'::jsonb
       end
  );
end;
$$;
