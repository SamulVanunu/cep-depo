-- Aşama 10B — attempt accounting, budget release and lease ownership (F-03).
--
-- The old claim incremented `attempts` before the worker touched the row. The
-- worker claims up to 25 jobs in one call but has only a 20 s run budget, so a
-- budget or crash exit left the rest of the batch leased with attempts
-- already spent. With a daily cron, five such exits could quarantine a file
-- that was never processed.
--
-- Two designs were evaluated:
--
--   A. Derive the claim size from the remaining run budget (the K16 rule).
--      This narrows the window but does not change the accounting point: a
--      claim that is abandoned before its first Storage call still spends an
--      attempt. A crashed run can always leave one.
--
--   B. Move the attempt charge to an explicit start transition and add a
--      release for claims that never started (this migration).
--
-- B is the root fix and is what the schema and the worker now enforce. A is
-- kept as a complementary guard in the worker: `p_limit` becomes a wave
-- ceiling derived from the usable budget, so the release path is normally a
-- no-op and at most a handful of claims need releasing.
--
-- Contract:
--
--   * cleanup_claim_jobs() takes a lease and a fresh lease_token; it does not
--     consume an attempt and does not write last_attempt_at;
--   * cleanup_start_job() is the only attempt-consuming transition and is
--     idempotent for the same live lease;
--   * cleanup_release_job() returns an unstarted claim only to the worker that
--     still owns the live lease token. It never changes attempts, skipped_at,
--     completed_at or a quarantine column;
--   * complete/fail/skip still work for callers that do not call start first:
--     they charge the attempt themselves. A real Storage failure therefore
--     keeps the existing retry/backoff/quarantine behaviour;
--   * the quiescence gate counts `started` events, not `claimed` events. A
--     released-but-never-started claim cannot poison it. Legacy rows with
--     attempts > 0 are backfilled with a `started` event so their old
--     protection is preserved.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.admin_asset_cleanup_jobs
  add column lease_token uuid,
  add column started_at timestamptz;

-- A token belongs to one claim only. The partial index keeps legacy rows with
-- no lease out of the uniqueness check.
create unique index admin_asset_cleanup_jobs_lease_token_idx
  on public.admin_asset_cleanup_jobs (lease_token)
  where lease_token is not null;

-- ---------------------------------------------------------------------------
-- Event vocabulary
-- ---------------------------------------------------------------------------

alter table public.admin_asset_cleanup_events
  drop constraint admin_asset_cleanup_events_outcome_check,
  add constraint admin_asset_cleanup_events_outcome_check check (outcome in (
    'claimed', 'started', 'released', 'completed', 'failed', 'skipped',
    'quarantined', 'requeued', 'orphan_enqueued', 'race_detected'
  ));

-- Backfill a started event for every legacy row that already spent an attempt.
-- The old model charged at claim time, so attempts > 0 is the only evidence
-- that a remove may have begun. Without this, a legacy second claim would be
-- allowed to free a path that an old worker may still be deleting.
insert into public.admin_asset_cleanup_events (
  job_id, bucket, path, attempt, outcome, worker_id, created_at
)
select
  j.id, j.bucket, j.path, j.attempts, 'started', j.worker_id,
  coalesce(j.last_attempt_at, j.updated_at, j.created_at)
from public.admin_asset_cleanup_jobs as j
where j.attempts > 0
  and not exists (
    select 1
    from public.admin_asset_cleanup_events as e
    where e.job_id = j.id
      and e.outcome = 'started'
  );

-- ---------------------------------------------------------------------------
-- cleanup_claim_jobs — lease only, no attempt charge
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
  lease_token uuid
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

  -- Step 0 — quarantine stranded jobs first. A worker that started the fifth
  -- attempt and crashed leaves attempts = 5 with an expired lease; the
  -- candidate filter excludes it, so without this it would stay pending
  -- forever. Running after the lease expired keeps a live attempt alive.
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
              j.operation_id, j.attempts, j.lease_expires_at, j.lease_token
  ), logged as (
    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, worker_id)
    select c.id, c.bucket, c.path, c.attempts + 1, 'claimed', p_worker_id
    from claimed as c
  )
  select c.id, c.bucket, c.path, c.target_type,
         c.operation_id, c.attempts, c.lease_expires_at, c.lease_token
  from claimed as c;
end;
$$;

-- ---------------------------------------------------------------------------
-- cleanup_start_job — the only attempt-consuming transition
-- ---------------------------------------------------------------------------

create function public.cleanup_start_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- cleanup_release_job — return an unstarted claim without charging an attempt
-- ---------------------------------------------------------------------------

create function public.cleanup_release_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- cleanup_complete_job — keep the old contract, charge a direct caller once
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_complete_job(
  p_job_id uuid,
  p_worker_id text
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
  v_attempts integer;
begin
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
$$;

-- ---------------------------------------------------------------------------
-- cleanup_fail_job — the retry/backoff/quarantine contract is unchanged
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_fail_job(
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
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- cleanup_skip_job — the quiescence gate now counts real starts
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_skip_job(
  p_job_id uuid,
  p_worker_id text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- Requeue paths: clear the new claim markers as well
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_requeue_job(
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
$$;

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

revoke all on function public.cleanup_start_job(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_start_job(uuid, text, uuid)
  to service_role;

revoke all on function public.cleanup_release_job(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_release_job(uuid, text, uuid)
  to service_role;

revoke all on function public.cleanup_complete_job(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_complete_job(uuid, text)
  to service_role;

revoke all on function public.cleanup_fail_job(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_fail_job(uuid, text, text)
  to service_role;

revoke all on function public.cleanup_skip_job(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_skip_job(uuid, text, text)
  to service_role;

-- F-02: the legacy requeue stays migration-role only.
revoke all on function public.cleanup_requeue_job(uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  to service_role;
