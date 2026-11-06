-- P0-3 / Task 1 — asset reference checks, path retirement and the seal.
--
-- The cleanup worker may delete a Storage object only when no reference
-- remains. A queued job (skipped_at is null) is a permanent tombstone for its
-- (bucket, path): every surface that can create a reference rejects writes to
-- it. cleanup_asset_is_referenced() is the seal: it takes an exclusive
-- advisory lock, checks in a fresh snapshot and, once it answers false, no new
-- reference can be created while the tombstone exists.
--
-- Lock protocol (both sides must use the same key):
--   * guards:  pg_advisory_xact_lock_shared(20261101, 1), then a separate
--              statement for the retirement check, held until commit;
--   * seal:    pg_advisory_xact_lock(20261101, 1), then a separate statement
--              for the reference check.
-- The check must be a separate statement in a VOLATILE function: a STABLE
-- function keeps the calling statement's snapshot and would miss a reference
-- committed while it waited on the lock.

alter table public.admin_asset_cleanup_jobs
  add column next_attempt_at timestamptz not null default now(),
  add column last_attempt_at timestamptz,
  add column last_error text,
  add column worker_id text,
  add column lease_expires_at timestamptz,
  add column skipped_at timestamptz,
  add column skip_reason text,
  add column quarantined_at timestamptz,
  add column quarantine_reason text;

alter table public.admin_asset_cleanup_jobs
  drop constraint admin_asset_cleanup_jobs_attempts_check,
  add constraint admin_asset_cleanup_jobs_attempts_check check (attempts between 0 and 5),
  -- Only a real, re-openable skip belongs here. The three terminal safety
  -- reasons live in quarantine_reason and never touch skipped_at, so they can
  -- never free the retired path again.
  add constraint admin_asset_cleanup_jobs_skip_check check (
    (skipped_at is null) = (skip_reason is null)
    and (skip_reason is null or skip_reason in (
      'referenced', 'ownership_mismatch'
    ))
  ),
  add constraint admin_asset_cleanup_jobs_quarantine_check check (
    (quarantined_at is null) = (quarantine_reason is null)
    and (quarantine_reason is null or quarantine_reason in (
      'attempts_exhausted', 'race_detected', 'quiescence_unproven'
    ))
  ),
  add constraint admin_asset_cleanup_jobs_terminal_check check (
    num_nonnulls(completed_at, skipped_at, quarantined_at) <= 1
  ),
  -- A lease must always have an owner. The converse is intentionally allowed:
  -- completing or skipping a job clears the lease but keeps worker_id as a
  -- trace (spec 6.3), and no code treats worker_id alone as a live lease.
  add constraint admin_asset_cleanup_jobs_lease_check check (
    lease_expires_at is null or worker_id is not null
  ),
  add constraint admin_asset_cleanup_jobs_error_check check (
    last_error is null or char_length(last_error) <= 500
  );

-- The worker never deletes a job: retirement rows are permanent until the
-- controlled purge. Revoking here also removes the grant made when the table
-- was first created.
revoke delete, truncate on table public.admin_asset_cleanup_jobs
  from public, anon, authenticated, service_role;

create index admin_asset_cleanup_jobs_due_idx
  on public.admin_asset_cleanup_jobs (next_attempt_at)
  where completed_at is null and skipped_at is null and quarantined_at is null;

-- The tombstone lookup: one index probe per reference write. Quarantined rows
-- keep skipped_at null on purpose, so they stay in this index and keep their
-- path closed forever.
create index admin_asset_cleanup_jobs_retired_path_idx
  on public.admin_asset_cleanup_jobs (bucket, path)
  where skipped_at is null;

create index apps_icon_path_idx on public.apps (icon_path) where icon_path is not null;

create index admin_audit_logs_version_draft_target_idx
  on public.admin_audit_logs (target_id) where action = 'version.draft';

-- ---------------------------------------------------------------------------
-- Retirement guard
-- ---------------------------------------------------------------------------

create function private.assert_asset_path_not_retired(p_bucket text, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Taken before the check and held until the caller commits, so the seal
  -- cannot pass between the check and the reference write.
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
$$;

revoke all on function private.assert_asset_path_not_retired(text, text)
  from public, anon, authenticated, service_role;

create function private.apps_guard_icon_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.icon_path is not null then
    perform private.assert_asset_path_not_retired('app-assets', new.icon_path);
  end if;
  return new;
end;
$$;

create function private.app_screenshots_guard_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_asset_path_not_retired('app-assets', new.path);
  return new;
end;
$$;

create function private.app_versions_guard_apk_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.apk_path is not null then
    perform private.assert_asset_path_not_retired('apks', new.apk_path);
  end if;
  return new;
end;
$$;

-- The apk-drafts reference is the join of a version.draft audit row with a
-- version still in draft status. Guarding both sides closes the two ways a
-- retired draft path could come back: an audit row written for a version that
-- does not exist yet (or that returns to draft), and an audit row written after
-- the version already exists.
create function private.app_versions_guard_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'draft' then
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
$$;

create function private.admin_audit_logs_guard_draft_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action = 'version.draft' and new.metadata->>'path' is not null then
    perform private.assert_asset_path_not_retired('apk-drafts', new.metadata->>'path');
  end if;
  return new;
end;
$$;

revoke all on function private.apps_guard_icon_path()
  from public, anon, authenticated, service_role;
revoke all on function private.app_screenshots_guard_path()
  from public, anon, authenticated, service_role;
revoke all on function private.app_versions_guard_apk_path()
  from public, anon, authenticated, service_role;
revoke all on function private.app_versions_guard_draft()
  from public, anon, authenticated, service_role;
revoke all on function private.admin_audit_logs_guard_draft_path()
  from public, anon, authenticated, service_role;

create trigger apps_icon_path_not_retired
  before insert or update of icon_path on public.apps
  for each row execute function private.apps_guard_icon_path();

create trigger app_screenshots_path_not_retired
  before insert or update of path on public.app_screenshots
  for each row execute function private.app_screenshots_guard_path();

create trigger app_versions_apk_path_not_retired
  before insert or update of apk_path on public.app_versions
  for each row execute function private.app_versions_guard_apk_path();

create trigger app_versions_draft_not_retired
  before insert or update of status on public.app_versions
  for each row execute function private.app_versions_guard_draft();

create trigger admin_audit_logs_draft_path_not_retired
  before insert on public.admin_audit_logs
  for each row execute function private.admin_audit_logs_guard_draft_path();

-- CLN05 — audit rows are immutable for every role. DELETE stays available so
-- test fixtures (and a future retention job) can still clear them.
create function private.admin_audit_logs_no_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'CLN05',
    message = 'Denetim kayıtları değiştirilemez.';
end;
$$;

revoke all on function private.admin_audit_logs_no_update()
  from public, anon, authenticated, service_role;

create trigger admin_audit_logs_immutable
  before update on public.admin_audit_logs
  for each row execute function private.admin_audit_logs_no_update();

-- ---------------------------------------------------------------------------
-- Reference check / seal
-- ---------------------------------------------------------------------------

create function public.cleanup_asset_is_referenced(p_bucket text, p_path text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_app_id uuid;
  v_version_id uuid;
  v_row_app_id uuid;
  v_match text[];
  v_result boolean;
begin
  -- Seal before any read. Released when this transaction ends.
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
$$;

revoke all on function public.cleanup_asset_is_referenced(text, text)
  from public, anon, authenticated;
grant execute on function public.cleanup_asset_is_referenced(text, text)
  to service_role;

-- ===========================================================================
-- Part B — job lifecycle: events, sweep state, seven RPCs, visibility view
-- ===========================================================================

-- Append-only attempt log. Kept separate from admin_audit_logs on purpose:
-- admin_record_external_action requires an admin actor and its action allowlist
-- does not cover the queue lifecycle (spec K9).
create table public.admin_asset_cleanup_events (
  id bigint generated always as identity primary key,
  -- RESTRICT: a job with history cannot be deleted by a plain DELETE. The only
  -- path is private.cleanup_purge_job(), which removes events first.
  job_id uuid not null references public.admin_asset_cleanup_jobs (id) on delete restrict,
  bucket text not null,
  path text not null,
  attempt integer not null default 0 check (attempt >= 0),
  outcome text not null check (outcome in (
    'claimed', 'completed', 'failed', 'skipped',
    'quarantined', 'requeued', 'orphan_enqueued', 'race_detected'
  )),
  error_code text,
  error_detail text check (error_detail is null or char_length(error_detail) <= 500),
  worker_id text,
  created_at timestamptz not null default now()
);

create index admin_asset_cleanup_events_job_idx
  on public.admin_asset_cleanup_events (job_id, created_at);
create index admin_asset_cleanup_events_created_idx
  on public.admin_asset_cleanup_events (created_at);
create index admin_asset_cleanup_events_failure_idx
  on public.admin_asset_cleanup_events (created_at)
  where outcome in ('failed', 'quarantined', 'skipped');

alter table public.admin_asset_cleanup_events enable row level security;
revoke all on table public.admin_asset_cleanup_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.admin_asset_cleanup_events to service_role;
grant usage, select on sequence public.admin_asset_cleanup_events_id_seq to service_role;

-- Append-only enforcement. UPDATE is always rejected; DELETE is allowed only
-- inside private.cleanup_purge_job(), which sets a transaction-local permit.
create function private.cleanup_guard_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = 'CLN06',
      message = 'Temizlik olayları değiştirilemez.';
  end if;
  if coalesce(current_setting('cep.cleanup_purge', true), 'off') <> 'on' then
    raise exception using
      errcode = 'CLN06',
      message = 'Temizlik olayları yalnız kontrollü purge ile silinebilir.';
  end if;
  return old;
end;
$$;

-- Retirement rows are undeletable outside the same controlled purge, including
-- a row that was never claimed (no event row to trip the foreign key).
create function private.cleanup_guard_job_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('cep.cleanup_purge', true), 'off') <> 'on' then
    raise exception using
      errcode = 'CLN06',
      message = 'Temizlik işleri yalnız kontrollü purge ile silinebilir.';
  end if;
  return old;
end;
$$;

revoke all on function private.cleanup_guard_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.cleanup_guard_job_delete()
  from public, anon, authenticated, service_role;

create trigger admin_asset_cleanup_events_immutable
  before update or delete on public.admin_asset_cleanup_events
  for each row execute function private.cleanup_guard_immutable();

create trigger admin_asset_cleanup_jobs_no_delete
  before delete on public.admin_asset_cleanup_jobs
  for each row execute function private.cleanup_guard_job_delete();

-- The one controlled deletion path. SECURITY DEFINER so a trusted maintenance
-- role can remove a job and its history atomically; never granted to an app
-- role or service_role. search_path is empty and every object is qualified.
create function private.cleanup_purge_job(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  perform set_config('cep.cleanup_purge', 'on', true);

  delete from public.admin_asset_cleanup_events
   where job_id = p_job_id;

  delete from public.admin_asset_cleanup_jobs
   where id = p_job_id;
  get diagnostics v_deleted = row_count;

  perform set_config('cep.cleanup_purge', 'off', true);

  return v_deleted;
end;
$$;

revoke all on function private.cleanup_purge_job(uuid)
  from public, anon, authenticated, service_role;

-- Singleton sweeper cursor. The sweeper never deletes; it only enqueues.
create table public.admin_asset_cleanup_sweep_state (
  id smallint primary key default 1 check (id = 1),
  bucket text not null default 'apk-drafts'
    check (bucket in ('apk-drafts', 'apks', 'app-assets')),
  last_folder text,
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger admin_asset_cleanup_sweep_state_set_updated_at
  before update on public.admin_asset_cleanup_sweep_state
  for each row execute function private.set_community_updated_at();

insert into public.admin_asset_cleanup_sweep_state (id)
values (1)
on conflict (id) do nothing;

alter table public.admin_asset_cleanup_sweep_state enable row level security;
revoke all on table public.admin_asset_cleanup_sweep_state
  from public, anon, authenticated;
grant select, insert, update on table public.admin_asset_cleanup_sweep_state
  to service_role;

-- Retry ladder. Attempt n is the attempt that just failed; the next try waits
-- for the interval of n (spec 6.1).
create function private.cleanup_backoff(p_attempt integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_attempt
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '15 minutes'
    when 4 then interval '1 hour'
    else interval '6 hours'
  end;
$$;

revoke all on function private.cleanup_backoff(integer)
  from public, anon, authenticated;
grant execute on function private.cleanup_backoff(integer) to service_role;

-- ---------------------------------------------------------------------------
-- cleanup_claim_jobs
-- ---------------------------------------------------------------------------

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
  lease_expires_at timestamptz
)
language plpgsql
security invoker
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

  -- Step 0 — quarantine stranded jobs first. A worker that claimed the fifth
  -- attempt and crashed leaves attempts = 5 with an expired lease; the
  -- candidate filter excludes it, so without this it would stay pending
  -- forever. Running after the lease expired keeps a live fifth attempt alive.
  -- Quarantine never writes skipped_at: the path must stay retired.
  with stranded as (
    update public.admin_asset_cleanup_jobs as j
       set quarantined_at = v_now,
           quarantine_reason = 'attempts_exhausted',
           worker_id = null,
           lease_expires_at = null
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
       set attempts = j.attempts + 1,
           last_attempt_at = v_now,
           worker_id = p_worker_id,
           lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
           next_attempt_at = v_now + private.cleanup_backoff(j.attempts + 1)
      from candidates as c
     where j.id = c.id
    returning j.id, j.bucket, j.path, j.target_type,
              j.operation_id, j.attempts, j.lease_expires_at
  ), logged as (
    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, worker_id)
    select c.id, c.bucket, c.path, c.attempts, 'claimed', p_worker_id
    from claimed as c
  )
  select c.id, c.bucket, c.path, c.target_type,
         c.operation_id, c.attempts, c.lease_expires_at
  from claimed as c;
end;
$$;

revoke all on function public.cleanup_claim_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_claim_jobs(text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- cleanup_complete_job
-- ---------------------------------------------------------------------------

create function public.cleanup_complete_job(p_job_id uuid, p_worker_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_attempts integer;
begin
  update public.admin_asset_cleanup_jobs
     set completed_at = v_now,
         lease_expires_at = null
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
$$;

revoke all on function public.cleanup_complete_job(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cleanup_complete_job(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- cleanup_fail_job
-- ---------------------------------------------------------------------------

create function public.cleanup_fail_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
returns table (
  attempts integer,
  next_attempt_at timestamptz,
  quarantined boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_attempts integer;
  v_next timestamptz;
  v_error text;
begin
  -- Redact URL query strings, then clip. The column check also caps at 500.
  v_error := regexp_replace(
    coalesce(p_error, ''),
    '(https?://[^?\s#]*)\?[^#\s]*',
    '\1?[redacted]',
    'g'
  );
  v_error := left(v_error, 500);

  update public.admin_asset_cleanup_jobs as j
     set last_error = v_error,
         last_error_at = v_now,
         lease_expires_at = null,
         worker_id = null
   where j.id = p_job_id
     and j.completed_at is null
     and j.skipped_at is null
     and j.quarantined_at is null
     and j.worker_id = p_worker_id
     and j.lease_expires_at > v_now
  returning j.bucket, j.path, j.attempts, j.next_attempt_at
       into v_bucket, v_path, v_attempts, v_next;

  if not found then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bu worker''ın canlı lease''i altında değil.';
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
$$;

revoke all on function public.cleanup_fail_job(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.cleanup_fail_job(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- cleanup_skip_job
-- ---------------------------------------------------------------------------

create function public.cleanup_skip_job(
  p_job_id uuid,
  p_worker_id text,
  p_reason text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_bucket text;
  v_path text;
  v_attempts integer;
  v_claimed integer;
  v_quarantine_reason text;
begin
  if p_reason is null
    or p_reason not in ('referenced', 'ownership_mismatch', 'race_detected')
  then
    raise exception using errcode = 'P0001', message = 'Geçersiz atlama nedeni.';
  end if;

  select bucket, path, attempts
    into v_bucket, v_path, v_attempts
    from public.admin_asset_cleanup_jobs
   where id = p_job_id
     and completed_at is null
     and skipped_at is null
     and quarantined_at is null
     and worker_id = p_worker_id
     and lease_expires_at > v_now
   for update;

  if not found then
    raise exception using
      errcode = 'CLN01',
      message = 'İş bu worker''ın canlı lease''i altında değil.';
  end if;

  -- A second claim means the earlier worker may already have started the
  -- Storage delete, so "referenced" is no longer proof that the object is
  -- safe. race_detected is always terminal. Neither may write skipped_at:
  -- quarantine keeps the path retired instead of reopening it.
  select count(*) into v_claimed
    from public.admin_asset_cleanup_events
   where job_id = p_job_id
     and outcome = 'claimed';

  if p_reason = 'race_detected' then
    v_quarantine_reason := 'race_detected';
  elsif p_reason = 'referenced' and v_claimed >= 2 then
    v_quarantine_reason := 'quiescence_unproven';
  end if;

  if v_quarantine_reason is not null then
    update public.admin_asset_cleanup_jobs
       set quarantined_at = v_now,
           quarantine_reason = v_quarantine_reason,
           lease_expires_at = null
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
         lease_expires_at = null
   where id = p_job_id;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, error_code, worker_id)
  values (p_job_id, v_bucket, v_path, v_attempts, 'skipped', p_reason, p_worker_id);

  return 'skipped';
end;
$$;

revoke all on function public.cleanup_skip_job(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.cleanup_skip_job(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- cleanup_requeue_job
-- ---------------------------------------------------------------------------

create function public.cleanup_requeue_job(
  p_job_id uuid,
  p_reason text default null
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
begin
  if exists (
    select 1 from public.admin_asset_cleanup_jobs
    where id = p_job_id and completed_at is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Tamamlanmış iş yeniden kuyruğa alınamaz.';
  end if;

  -- A live lease must be refused: requeueing a job that is being deleted would
  -- lift the tombstone after the seal and reopen the lost-object window.
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
         lease_expires_at = null
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
$$;

revoke all on function public.cleanup_requeue_job(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cleanup_requeue_job(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- cleanup_enqueue_orphan
-- ---------------------------------------------------------------------------

create function public.cleanup_enqueue_orphan(
  p_bucket text,
  p_path text,
  p_target_type text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

revoke all on function public.cleanup_enqueue_orphan(text, text, text)
  from public, anon, authenticated;
grant execute on function public.cleanup_enqueue_orphan(text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Visibility view
-- ---------------------------------------------------------------------------

create view public.admin_asset_cleanup_queue_stats
with (security_invoker = true)
as
select
  count(*) filter (
    where j.completed_at is null and j.skipped_at is null
      and j.quarantined_at is null
  ) as pending,
  count(*) filter (
    where j.completed_at is null and j.skipped_at is null
      and j.quarantined_at is null
      and j.next_attempt_at <= now()
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
  ) as due,
  count(*) filter (
    where j.completed_at is null and j.skipped_at is null
      and j.quarantined_at is null
      and j.lease_expires_at > now()
  ) as leased,
  count(*) filter (where j.skipped_at is not null) as skipped,
  count(*) filter (where j.quarantined_at is not null) as quarantined,
  count(*) filter (where j.completed_at is not null) as completed,
  coalesce(
    extract(epoch from now() - min(j.created_at) filter (
      where j.completed_at is null and j.skipped_at is null
        and j.quarantined_at is null
    ))::bigint,
    0
  ) as oldest_pending_age_seconds,
  count(*) filter (
    where j.completed_at is null and j.skipped_at is null
      and j.quarantined_at is null
      and j.attempts >= 5
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
  ) as stranded,
  (
    select count(*) from public.admin_asset_cleanup_events as e
    where e.outcome = 'failed' and e.created_at > now() - interval '24 hours'
  ) as failed_last_24h,
  (
    select count(*) from public.admin_asset_cleanup_events as e
    where e.outcome = 'skipped'
      and e.created_at > now() - interval '24 hours'
  ) as skipped_last_24h,
  (
    select count(*) from public.admin_asset_cleanup_events as e
    where e.outcome = 'race_detected'
      and e.created_at > now() - interval '24 hours'
  ) as races_last_24h
from public.admin_asset_cleanup_jobs as j;

revoke all on table public.admin_asset_cleanup_queue_stats
  from public, anon, authenticated;
grant select on table public.admin_asset_cleanup_queue_stats to service_role;

-- ---------------------------------------------------------------------------
-- Pending uniqueness now excludes skipped jobs
-- ---------------------------------------------------------------------------
-- A skipped job means "not deleted": its path is free again and a new queue
-- row must be possible. The two SQL producers below use the same predicate and
-- are replaced in this migration; both must stay in sync with this index.

drop index public.admin_asset_cleanup_jobs_pending_object_idx;
create unique index admin_asset_cleanup_jobs_pending_object_idx
  on public.admin_asset_cleanup_jobs (bucket, path)
  where completed_at is null and skipped_at is null;

-- ---------------------------------------------------------------------------
-- Align the two SQL producers with the new conflict predicate
-- ---------------------------------------------------------------------------

create or replace function public.admin_publish_version_replacing_previous(p_actor_id uuid, p_version_id uuid)
 returns text[]
 language plpgsql
 set search_path to ''
as $function$
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
$function$;

create or replace function public.admin_delete_app_permanently(p_actor_id uuid, p_app_id uuid, p_confirmation_title text)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
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
$function$;
