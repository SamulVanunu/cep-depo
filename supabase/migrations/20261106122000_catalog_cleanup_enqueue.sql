-- P8 — the release-scoped enqueue for catalog cleanup.
--
-- `cleanup_enqueue_orphan()` deliberately keeps rejecting the `catalog` bucket:
-- a generic orphan enqueue cannot prove that a release is outside the
-- retention window. This RPC is the only producer of catalog jobs, and it
-- proves that under the same global exclusive advisory lock the seal uses:
--
--   1. the caller is an admin;
--   2. the global lock (20261101, 1) serialises the write with the seal, the
--      retire guard and every other tombstone writer;
--   3. the pointer is read once, after the lock;
--   4. reconciliation, generation zero, a stale plan, the current release, the
--      retention window and the history are all checked before any row exists;
--   5. each document is inserted separately, so one document can be pending
--      while the other is completed or quarantined;
--   6. a new job records one `catalog_enqueued` event and the release gets one
--      `catalog.gc` audit row — a dedupe or a refusal writes neither.
--
-- The result is one row per requested document, so the caller never has to
-- guess which files were accepted.

create function public.cleanup_enqueue_catalog_release(
  p_actor_id uuid,
  p_release_id text,
  p_expected_generation bigint,
  p_expected_restore_epoch bigint,
  p_files text[]
)
returns table (
  release_id text,
  path text,
  job_id uuid,
  outcome text,
  blocked_code text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_file text;
  v_path text;
  v_generation bigint;
  v_current_release text;
  v_floor bigint;
  v_restore_epoch bigint;
  v_recon boolean;
  v_existing_id uuid;
  v_existing_completed timestamptz;
  v_existing_skipped timestamptz;
  v_existing_quarantined timestamptz;
  v_job_id uuid;
  v_new_jobs integer := 0;
begin
  perform private.require_admin_actor(p_actor_id);

  if p_release_id is null or p_release_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception using errcode = 'P0001', message = 'Geçersiz release kimliği.';
  end if;

  if p_expected_generation is null or p_expected_generation < 0
     or p_expected_restore_epoch is null or p_expected_restore_epoch < 0 then
    raise exception using errcode = 'P0001', message = 'Geçersiz plan beklentisi.';
  end if;

  if p_files is null or array_length(p_files, 1) is null then
    raise exception using errcode = 'P0001', message = 'Temizlenecek dosya belirtilmedi.';
  end if;

  if exists (
    select 1
    from unnest(p_files) as file
    where file is null or file not in ('apps.json', 'categories.json')
  ) then
    raise exception using errcode = 'P0001', message = 'Geçersiz katalog dosyası.';
  end if;

  -- Lock first, then read. Under Read Committed every later statement sees a
  -- fresh snapshot, so the checks below describe the ledger the lock protects.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  select p.generation, p.release_id, p.retained_from_generation,
         p.restore_epoch, p.reconciliation_required
    into v_generation, v_current_release, v_floor, v_restore_epoch, v_recon
    from public.get_catalog_pointer() as p;

  for v_file in
    select distinct file
    from unnest(p_files) as file
    order by file
  loop
    v_path := 'releases/' || p_release_id || '/' || v_file;

    release_id := p_release_id;
    path := v_path;
    job_id := null;
    outcome := null;
    blocked_code := null;

    if v_recon then
      outcome := 'blocked';
      blocked_code := 'RECONCILIATION_ACTIVE';
      return next;
      continue;
    end if;

    if v_generation <= 0 then
      outcome := 'blocked';
      blocked_code := 'CATALOG_NOT_PUBLISHED';
      return next;
      continue;
    end if;

    if v_generation <> p_expected_generation
       or v_restore_epoch <> p_expected_restore_epoch then
      outcome := 'blocked';
      blocked_code := 'STALE_PLAN';
      return next;
      continue;
    end if;

    if p_release_id = v_current_release then
      outcome := 'blocked';
      blocked_code := 'CURRENT_RELEASE';
      return next;
      continue;
    end if;

    if exists (
      select 1
      from public.catalog_publish_history as history
      where history.release_id = p_release_id
        and history.generation >= v_floor
    ) then
      outcome := 'blocked';
      blocked_code := 'RETAINED_GENERATION';
      return next;
      continue;
    end if;

    if not exists (
      select 1
      from public.catalog_publish_history as history
      where history.release_id = p_release_id
    ) then
      outcome := 'blocked';
      blocked_code := 'RELEASE_NOT_IN_HISTORY';
      return next;
      continue;
    end if;

    -- The most meaningful existing row for this object. A live pending row
    -- wins; then a quarantined one; then a completed one; skipped rows are the
    -- weakest because they reopened the path for exactly this insert.
    select job.id, job.completed_at, job.skipped_at, job.quarantined_at
      into v_existing_id, v_existing_completed,
           v_existing_skipped, v_existing_quarantined
      from public.admin_asset_cleanup_jobs as job
     where job.bucket = 'catalog'
       and job.path = v_path
     order by
       case
         when job.completed_at is null and job.skipped_at is null
              and job.quarantined_at is null then 0
         when job.completed_at is null and job.skipped_at is null
              and job.quarantined_at is not null then 1
         when job.completed_at is not null then 2
         else 3
       end,
       job.created_at desc
     limit 1;

    if v_existing_id is not null then
      if v_existing_completed is null
         and v_existing_skipped is null
         and v_existing_quarantined is null then
        job_id := v_existing_id;
        outcome := 'deduped';
        return next;
        continue;
      elsif v_existing_completed is null and v_existing_skipped is null then
        job_id := v_existing_id;
        outcome := 'quarantined';
        return next;
        continue;
      elsif v_existing_completed is not null then
        -- The document was deleted once. A file that came back would break the
        -- immutable-release contract, so fail closed for the operator instead
        -- of silently deleting it a second time.
        job_id := v_existing_id;
        outcome := 'already_completed';
        return next;
        continue;
      end if;
    end if;

    v_job_id := null;

    insert into public.admin_asset_cleanup_jobs (
      bucket, path, operation_id, catalog_release_id, target_type
    )
    values (
      'catalog', v_path, null, p_release_id, 'catalog_document'
    )
    on conflict (bucket, path)
      where completed_at is null and skipped_at is null
      do nothing
    returning id into v_job_id;

    if v_job_id is null then
      -- The advisory lock should make this unreachable. If it ever happens,
      -- report the settled row rather than inventing a new deletion.
      select job.id, job.quarantined_at
        into v_existing_id, v_existing_quarantined
        from public.admin_asset_cleanup_jobs as job
       where job.bucket = 'catalog'
         and job.path = v_path
         and job.completed_at is null
         and job.skipped_at is null
       order by job.created_at desc
       limit 1;

      if v_existing_id is null then
        raise exception using
          errcode = 'P0001',
          message = 'Katalog işi yarışı çözülemedi.';
      end if;

      job_id := v_existing_id;
      outcome := case
        when v_existing_quarantined is not null then 'quarantined'
        else 'deduped'
      end;
      return next;
      continue;
    end if;

    insert into public.admin_asset_cleanup_events (
      job_id, bucket, path, attempt, outcome
    )
    values (v_job_id, 'catalog', v_path, 0, 'catalog_enqueued');

    v_new_jobs := v_new_jobs + 1;
    job_id := v_job_id;
    outcome := 'enqueued';
    return next;
  end loop;

  if v_new_jobs > 0 then
    insert into public.admin_audit_logs (
      actor_id, action, target_type, target_id, metadata
    )
    values (
      p_actor_id, 'catalog.gc', 'catalog_release', p_release_id,
      jsonb_build_object(
        'release_id', p_release_id,
        'generation', v_generation,
        'retained_from_generation', v_floor
      )
    );
  end if;

  return;
end;
$$;

revoke all on function public.cleanup_enqueue_catalog_release(
  uuid, text, bigint, bigint, text[]
) from public, anon, authenticated, service_role;

grant execute on function public.cleanup_enqueue_catalog_release(
  uuid, text, bigint, bigint, text[]
) to service_role;
