-- Aşama 10C — Storage object identity for cleanup jobs (F-06).
--
-- A cleanup tombstone only knows bucket + path. A path is not an identity: the
-- object at that path can be replaced after the tombstone was written, and a
-- retry that deletes "the object at path X" would then destroy the replacement.
--
-- Three layers close that window:
--
--   1. Every new job pins storage.objects.version in `storage_version`. The
--      BEFORE INSERT trigger always overwrites the value from Storage, so no
--      producer (and certainly not a browser) can forge it. An object that did
--      not exist when the job row was created leaves the column null: the
--      worker then fails closed instead of guessing.
--
--   2. Legacy rows are backfilled only when storage.objects.updated_at is not
--      later than the job's created_at. A newer object is never adopted.
--
--   3. cleanup_claim_jobs() returns the pinned version. The worker deletes with
--      `remove([{ path, versionId }])`, which Storage implements as a
--      conditional DELETE on (bucket_id, name, version). A replaced object is
--      untouched and the call reports it removed nothing.
--
-- The admin requeue repeats the identity decision inside its transaction
-- (CLN10). The TypeScript action also probes Storage for the operator, but the
-- RPC compares the stored fingerprint with the live storage.objects row, so a
-- forged client flag or a stale page cannot lift a quarantine whose object is
-- no longer provably the original.

-- ---------------------------------------------------------------------------
-- Pinned fingerprint
-- ---------------------------------------------------------------------------

alter table public.admin_asset_cleanup_jobs
  add column storage_version text;

comment on column public.admin_asset_cleanup_jobs.storage_version is
  'storage.objects.version captured when the job was enqueued; null when the object did not exist or could not be proven to predate the job.';

create function private.cleanup_capture_storage_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Never trust a caller-supplied value. This is the only writer.
  new.storage_version := null;

  select object.version
    into new.storage_version
  from storage.objects as object
  where object.bucket_id = new.bucket
    and object.name = new.path
    and object.archived_at is null
    -- The object must already exist when the tombstone is created. An object
    -- written afterwards is a replacement and must never inherit this job.
    and object.updated_at <= coalesce(new.created_at, now());

  return new;
end;
$$;

create trigger admin_asset_cleanup_jobs_capture_storage_version
before insert on public.admin_asset_cleanup_jobs
for each row
execute function private.cleanup_capture_storage_version();

-- Legacy rows: adopt the live version only when the object demonstrably
-- predates the job. Rows whose object is newer stay null and require manual
-- review before any retry.
update public.admin_asset_cleanup_jobs as job
   set storage_version = object.version
  from storage.objects as object
 where job.storage_version is null
   and object.bucket_id = job.bucket
   and object.name = job.path
   and object.archived_at is null
   and object.updated_at <= job.created_at;

-- ---------------------------------------------------------------------------
-- cleanup_claim_jobs — expose the pinned fingerprint
-- ---------------------------------------------------------------------------

drop function public.cleanup_claim_jobs(text, integer, integer);

create function public.cleanup_claim_jobs(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns table (
  job_id uuid,
  bucket text,
  path text,
  target_type text,
  operation_id uuid,
  attempts integer,
  lease_expires_at timestamptz,
  lease_token uuid,
  storage_version text
)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- admin_requeue_cleanup_job — CLN10 when identity is not provable
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
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.cleanup_claim_jobs(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_claim_jobs(text, integer, integer)
  to service_role;

revoke all on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  to service_role;
