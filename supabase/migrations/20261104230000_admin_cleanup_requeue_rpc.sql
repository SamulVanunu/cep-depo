-- Aşama 8 / M1 — audited admin requeue for quarantined cleanup jobs.
--
-- cleanup_requeue_job() stays untouched: it is the service/test primitive and
-- has no actor, reference or identity checks. This migration adds a separate
-- admin surface that:
--
--   * requires a verified admin actor,
--   * only accepts a genuinely quarantined job (never completed, skipped or
--     pending, and never under a live worker lease),
--   * uses the quarantine timestamp as an optimistic token (CLN08 on mismatch),
--   * re-derives the asset identity from bucket/target_type/path with the same
--     rules as the TypeScript managedTarget(), and requires it to equal the
--     stored operation_id,
--   * runs the reference seal in the same transaction (CLN07 when referenced),
--   * never touches skipped_at/completed_at, so the retired path stays closed,
--   * writes the requeued event and an append-only audit row atomically: an
--     audit failure rolls the whole requeue back.
--
-- The audit goes through admin_record_external_action so the metadata whitelist
-- remains the single gate. That whitelist and the action allowlist are extended
-- explicitly here; unknown keys are still dropped rather than persisted.

-- ---------------------------------------------------------------------------
-- Audit allowlist: cleanup.requeue
-- ---------------------------------------------------------------------------

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
      'user.suspend', 'user.activate', 'user.delete', 'user.recovery_request',
      'catalog.publish', 'catalog.rollback', 'catalog.reconcile', 'catalog.gc',
      'cleanup.requeue'
    ])
  );

-- Keep the delegate's own allowlist, target-type map and metadata whitelist in
-- sync. Only additive changes: every previous action, target type and key keeps
-- its exact meaning.
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
  -- joining a mutable queue row.
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
-- admin_requeue_cleanup_job
-- ---------------------------------------------------------------------------

create function public.admin_requeue_cleanup_job(
  p_job_id uuid,
  p_actor_id uuid,
  p_expected_quarantined_at timestamptz,
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
  v_note text;
  v_match text[];
  v_asset_id uuid;
  v_updated integer;
begin
  -- Fail closed before touching the row, so a non-admin cannot use the RPC to
  -- probe queue state.
  perform private.require_admin_actor(p_actor_id);

  v_note := btrim(coalesce(p_note, ''));
  if char_length(v_note) < 10 or char_length(v_note) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'Yeniden kuyruğa alma açıklaması 10-500 karakter olmalıdır.';
  end if;

  -- One row lock serializes two admin clicks (and any worker transition) on the
  -- same job. The quarantine timestamp below is the optimistic token.
  select bucket, path, target_type, operation_id, attempts,
         quarantined_at, quarantine_reason, completed_at, skipped_at,
         lease_expires_at
    into v_bucket, v_path, v_target_type, v_operation_id, v_attempts,
         v_quarantined_at, v_quarantine_reason, v_completed_at, v_skipped_at,
         v_lease_expires_at
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

  -- A live lease means a worker may be inside seal -> remove -> recheck right
  -- now. Requeueing would lift the tombstone mid-delete and reopen the
  -- lost-object window.
  if v_lease_expires_at is not null and v_lease_expires_at > v_now then
    raise exception using
      errcode = 'CLN01',
      message = 'İş canlı bir lease altında; yeniden kuyruğa alınamaz.';
  end if;

  -- Same identity rules as managedTarget() in the admin app: bucket, target type
  -- and canonical path must agree, and the asset id is derived from the path.
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

  -- This is the same seal the worker uses: exclusive advisory lock, fresh
  -- statement snapshot, ownership validation. If it answers false, no new
  -- reference can appear while the tombstone exists. The check stays inside
  -- this transaction so the queue update and the reference decision agree.
  if public.cleanup_asset_is_referenced(v_bucket, v_path) then
    raise exception using
      errcode = 'CLN07',
      message = 'Dosya hâlâ bir kayıt tarafından kullanılıyor; yeniden kuyruğa alınamaz.';
  end if;

  -- skipped_at and completed_at are intentionally absent: quarantine never
  -- wrote them, and requeue must keep the path retired. A requeued job is due
  -- immediately with a fresh attempt budget.
  update public.admin_asset_cleanup_jobs
     set quarantined_at = null,
         quarantine_reason = null,
         attempts = 0,
         next_attempt_at = v_now,
         worker_id = null,
         lease_expires_at = null
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

  -- Audit is not best-effort here: a requeue without its actor-facing row would
  -- be an untraceable destructive decision. The delegate raises on any contract
  -- violation, and the exception rolls back the job update and the event above.
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
$$;

revoke all on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  to service_role;
