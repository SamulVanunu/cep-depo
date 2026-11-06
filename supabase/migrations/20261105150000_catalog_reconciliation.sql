-- P6 — catalog reconciliation and restore safety.
--
-- A restore can move PostgreSQL backwards while Storage still holds the
-- objects a newer generation wrote. No lease, no transaction and no advisory
-- lock can recall an HTTP DELETE that has already left the worker. P6 therefore
-- makes "unknown" a first-class state:
--
--   * `catalog_publish_state` owns the real `restore_epoch` and
--     `reconciliation_required` values that `get_catalog_pointer()` publishes;
--   * `begin_catalog_reconciliation()` takes the global exclusive lock,
--     increments the epoch, sets the flag, releases every claim that never
--     started, and never touches a started job;
--   * `finish_catalog_reconciliation()` refuses to close while any started job
--     is still non-terminal — even with an expired lease — and requires an
--     explicit operator drain proof;
--   * `admin_quarantine_cleanup_job()` is the only way to close an ambiguous
--     started job; it keeps `started_at` and the tombstone as evidence;
--   * history inserts, new publish/maintenance/manifest tokens, the reference
--     seal and the manifest assert are all refused while reconciliation runs;
--   * drain paths (complete/fail on a started job, release of an unstarted
--     claim) stay allowed, because refusing them would make the drain
--     impossible.
--
-- SQLSTATEs:
--   CDP20  a write that could start or authorise work is blocked
--   CDP21  reconciliation state / generation / epoch conflict
--   CDP22  the operator drain proof is missing, malformed or incomplete

-- ---------------------------------------------------------------------------
-- 1. Real state columns
-- ---------------------------------------------------------------------------

alter table public.catalog_publish_state
  add column restore_epoch bigint not null default 0,
  add column reconciliation_required boolean not null default false,
  add column reconciliation_started_at timestamptz,
  add column reconciliation_started_by uuid,
  add column reconciliation_note text;

-- Generation zero is the empty catalog and is reconciled by definition.
-- Existing non-zero rows are backfilled to the same values: no restore has been
-- recorded against them yet, so claiming otherwise would invent history.
alter table public.catalog_publish_state
  add constraint catalog_publish_state_restore_epoch_nonneg check (
    restore_epoch >= 0
  ),
  add constraint catalog_publish_state_reconciliation_pair check (
    reconciliation_required = (reconciliation_started_at is not null)
  ),
  add constraint catalog_publish_state_reconciliation_note_len check (
    reconciliation_note is null
    or char_length(reconciliation_note) between 1 and 500
  );

-- ---------------------------------------------------------------------------
-- 2. Pointer reads the real columns
-- ---------------------------------------------------------------------------

create or replace function public.get_catalog_pointer()
returns table (
  generation bigint,
  release_id text,
  generated_at timestamptz,
  app_count integer,
  category_count integer,
  retained_from_generation bigint,
  restore_epoch bigint,
  reconciliation_required boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_head public.catalog_publish_history%rowtype;
  v_floor bigint;
  v_rows bigint;
  v_max bigint;
begin
  select *
    into v_state
    from public.catalog_publish_state
   where id = 1;

  if not found then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog pointer durumu bulunamadı.';
  end if;

  -- Generation zero is the only state with no history at all. A history row
  -- under a zero pointer means a restore or a bad write, not an empty catalog.
  if v_state.generation = 0 then
    if exists (select 1 from public.catalog_publish_history) then
      raise exception using
        errcode = 'CDP15',
        message = 'Katalog pointer sıfır nesildeyken geçmiş satırı var.';
    end if;

    return query
      select
        0::bigint,
        null::text,
        null::timestamptz,
        null::integer,
        null::integer,
        0::bigint,
        v_state.restore_epoch,
        v_state.reconciliation_required;
    return;
  end if;

  -- The head row is the only row the pointer may describe.
  select *
    into v_head
    from public.catalog_publish_history as h
   where h.generation = v_state.generation;

  if not found then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog pointer''ının head geçmiş satırı yok.';
  end if;

  if v_head.release_id is distinct from v_state.current_release_id
     or v_head.generated_at is distinct from v_state.generated_at
     or v_head.app_count is distinct from v_state.app_count
     or v_head.category_count is distinct from v_state.category_count
  then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog pointer''ı head geçmiş satırıyla uyuşmuyor.';
  end if;

  -- Generations start at 1, are positive and unique, so count = max = head
  -- proves the whole range is present without trusting application code. The
  -- unique index supports this as an index-only scan.
  select count(*), max(h.generation)
    into v_rows, v_max
    from public.catalog_publish_history as h;

  if v_max is distinct from v_state.generation
     or v_rows <> v_state.generation
  then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog geçmişinde nesil boşluğu var.';
  end if;

  v_floor := greatest(
    0::bigint,
    v_state.generation
      - (private.catalog_retention_generations() - 1)::bigint
  );

  return query
    select
      v_state.generation,
      v_state.current_release_id,
      v_state.generated_at,
      v_state.app_count,
      v_state.category_count,
      v_floor,
      v_state.restore_epoch,
      v_state.reconciliation_required;
end;
$$;

revoke all on function public.get_catalog_pointer()
  from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_pointer()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Gates that cannot be bypassed by a different RPC or a direct UPDATE
-- ---------------------------------------------------------------------------

-- A history row is the moment a publish or rollback becomes authoritative.
-- Refusing the insert stops both commit RPCs before the pointer can move.
create function private.catalog_history_reconciliation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.catalog_publish_state as s
    where s.id = 1
      and s.reconciliation_required
  ) then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; yayın geçmişi yazılamaz.';
  end if;

  return new;
end;
$$;

revoke all on function private.catalog_history_reconciliation_guard()
  from public, anon, authenticated, service_role;

create trigger catalog_publish_history_reconciliation_guard
  before insert on public.catalog_publish_history
  for each row execute function private.catalog_history_reconciliation_guard();

-- New publish, maintenance and manifest tokens are the entry points to a
-- Storage write. Token -> null releases and same-token renewals stay allowed so
-- an owner can always hand its claim back.
create function private.catalog_state_reconciliation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.reconciliation_required or new.reconciliation_required then
    if (
      new.publish_lock_token is not null
      and new.publish_lock_token is distinct from old.publish_lock_token
    ) or (
      new.maintenance_lock_token is not null
      and new.maintenance_lock_token is distinct from old.maintenance_lock_token
    ) or (
      new.manifest_claim_token is not null
      and new.manifest_claim_token is distinct from old.manifest_claim_token
    ) then
      raise exception using
        errcode = 'CDP20',
        message = 'Katalog uzlaştırması etkin; yeni kilit veya manifest talebi alınamaz.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.catalog_state_reconciliation_guard()
  from public, anon, authenticated, service_role;

create trigger catalog_publish_state_reconciliation_guard
  before update on public.catalog_publish_state
  for each row execute function private.catalog_state_reconciliation_guard();

-- Cleanup rows are the other entry point. The trigger covers every writer,
-- including one that updates the table directly instead of calling an RPC.
create function private.cleanup_jobs_reconciliation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reconciliation_required boolean;
begin
  select s.reconciliation_required
    into v_reconciliation_required
    from public.catalog_publish_state as s
   where s.id = 1;

  if not coalesce(v_reconciliation_required, false) then
    return new;
  end if;

  -- A new or replaced lease token would let a worker begin a DELETE.
  if new.lease_token is not null
    and new.lease_token is distinct from old.lease_token then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; yeni temizlik lease''i alınamaz.';
  end if;

  -- A start marker may never appear or disappear during reconciliation. The
  -- start marker is the only evidence that a Storage DELETE may be in flight.
  if old.started_at is null and new.started_at is not null then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; temizlik işi başlatılamaz.';
  end if;

  if old.started_at is not null and new.started_at is null then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; başlama kaydı silinemez.';
  end if;

  -- skipped_at is the tombstone that retires a path. Setting or clearing it
  -- would change what may be deleted later.
  if new.skipped_at is distinct from old.skipped_at then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; mezar taşı değiştirilemez.';
  end if;

  -- Clearing a terminal marker would reopen or hide an outcome. Setting one is
  -- how an already-started job drains through quarantine.
  if old.quarantined_at is not null and new.quarantined_at is null then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; karantina kaydı silinemez.';
  end if;

  if old.completed_at is not null and new.completed_at is null then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; tamamlanma kaydı silinemez.';
  end if;

  return new;
end;
$$;

revoke all on function private.cleanup_jobs_reconciliation_guard()
  from public, anon, authenticated, service_role;

create trigger admin_asset_cleanup_jobs_reconciliation_guard
  before update on public.admin_asset_cleanup_jobs
  for each row execute function private.cleanup_jobs_reconciliation_guard();

-- ---------------------------------------------------------------------------
-- 4. Shared drain primitive
-- ---------------------------------------------------------------------------

-- Releases every claim that never started and records who held it. Started
-- jobs are deliberately untouched: their DELETE may already be in flight and
-- only complete/fail/quarantine may close them.
create function private.catalog_release_unstarted_cleanup_claims(
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_released integer := 0;
begin
  for v_job in
    select j.id, j.bucket, j.path, j.attempts, j.worker_id
    from public.admin_asset_cleanup_jobs as j
    where j.completed_at is null
      and j.skipped_at is null
      and j.quarantined_at is null
      and j.started_at is null
      and (j.worker_id is not null or j.lease_token is not null)
    for update
  loop
    update public.admin_asset_cleanup_jobs
       set worker_id = null,
           lease_expires_at = null,
           lease_token = null,
           next_attempt_at = p_now
     where id = v_job.id;

    insert into public.admin_asset_cleanup_events
      (job_id, bucket, path, attempt, outcome, worker_id)
    values (
      v_job.id, v_job.bucket, v_job.path, v_job.attempts,
      'released', v_job.worker_id
    );

    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

revoke all on function private.catalog_release_unstarted_cleanup_claims(timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Begin / finish / quarantine
-- ---------------------------------------------------------------------------

create function public.begin_catalog_reconciliation(
  p_actor_id uuid,
  p_note text
)
returns table (
  restore_epoch bigint,
  generation bigint,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_now timestamptz;
  v_epoch bigint;
  v_note text;
begin
  if p_actor_id is null then
    raise exception using errcode = '22004',
      message = 'Aktör kimliği zorunlu.';
  end if;

  perform private.require_admin_actor(p_actor_id);

  -- Same lock key and ordering as every other writer: global exclusive first,
  -- then the singleton state row.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  begin
    select *
    into v_state
    from public.catalog_publish_state as s
    where s.id = 1
    for update;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Katalog yayın kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  if v_state.reconciliation_required then
    raise exception using errcode = 'CDP21',
      message = 'Katalog uzlaştırması zaten etkin.';
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- A live publisher may still write a manifest. An expired lease is not live:
  -- the old publisher is already fenced by its own expiry check.
  if v_state.publish_lock_token is not null
    and v_state.publish_lock_expires_at > v_now then
    raise exception using errcode = 'CDP21',
      message = 'Canlı bir yayın kilidi varken uzlaştırma başlatılamaz.';
  end if;

  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    raise exception using errcode = 'CDP21',
      message = 'Canlı bir bakım kilidi varken uzlaştırma başlatılamaz.';
  end if;

  v_epoch := v_state.restore_epoch + 1;
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  update public.catalog_publish_state
     set restore_epoch = v_epoch,
         reconciliation_required = true,
         reconciliation_started_at = v_now,
         reconciliation_started_by = p_actor_id,
         reconciliation_note = v_note
   where id = 1;

  -- Invalidate every claim that never started before an old worker can turn it
  -- into a DELETE. Started jobs are left for complete/fail/quarantine.
  perform private.catalog_release_unstarted_cleanup_claims(v_now);

  insert into public.admin_audit_logs
    (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'catalog.reconcile',
    'catalog_release',
    coalesce(v_state.current_release_id, 'generation:' || v_state.generation::text),
    jsonb_build_object(
      'phase', 'begin',
      'restore_epoch', v_epoch,
      'generation', v_state.generation,
      'note', v_note
    )
  );

  return query select v_epoch, v_state.generation, v_now;
end;
$$;

revoke all on function public.begin_catalog_reconciliation(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_catalog_reconciliation(uuid, text)
  to service_role;

create function public.finish_catalog_reconciliation(
  p_actor_id uuid,
  p_expected_generation bigint,
  p_expected_restore_epoch bigint,
  p_drain_proof jsonb
)
returns table (
  restore_epoch bigint,
  generation bigint,
  finished_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_now timestamptz;
  v_worker_ids jsonb;
  v_drained_at timestamptz;
  v_drained_text text;
begin
  if p_actor_id is null
    or p_expected_generation is null
    or p_expected_restore_epoch is null then
    raise exception using errcode = '22004',
      message = 'Aktör, nesil ve uzlaştırma dönemi zorunlu.';
  end if;

  perform private.require_admin_actor(p_actor_id);

  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  begin
    select *
    into v_state
    from public.catalog_publish_state as s
    where s.id = 1
    for update;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Katalog yayın kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  if not v_state.reconciliation_required then
    raise exception using errcode = 'CDP21',
      message = 'Etkin bir katalog uzlaştırması yok.';
  end if;

  if v_state.generation <> p_expected_generation then
    raise exception using errcode = 'CDP21',
      message = 'Beklenen nesil güncel durumla uyuşmuyor.';
  end if;

  if v_state.restore_epoch <> p_expected_restore_epoch then
    raise exception using errcode = 'CDP21',
      message = 'Beklenen uzlaştırma dönemi güncel durumla uyuşmuyor.';
  end if;

  -- Explicit operator proof. A lease expiry, a quiet queue or a successful
  -- query is not proof that an in-flight HTTP DELETE has finished.
  if p_drain_proof is null
    or jsonb_typeof(p_drain_proof) <> 'object'
    or (p_drain_proof->'worker_drained') is distinct from 'true'::jsonb
    or (p_drain_proof->'storage_calls_drained') is distinct from 'true'::jsonb
    or (p_drain_proof->'operator_reviewed') is distinct from 'true'::jsonb then
    raise exception using errcode = 'CDP22',
      message = 'Temizlik boşaltma kanıtı eksik veya geçersiz.';
  end if;

  v_worker_ids := p_drain_proof->'worker_ids';
  if v_worker_ids is null
    or jsonb_typeof(v_worker_ids) <> 'array'
    or jsonb_array_length(v_worker_ids) = 0 then
    raise exception using errcode = 'CDP22',
      message = 'Boşaltma kanıtı en az bir worker kimliği içermeli.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_worker_ids) as elem(value)
    where jsonb_typeof(elem.value) <> 'string'
      or btrim(elem.value #>> '{}') = ''
  ) then
    raise exception using errcode = 'CDP22',
      message = 'Worker kimlikleri boş olmayan metinler olmalı.';
  end if;

  if (
    select count(distinct elem.value #>> '{}')
    from jsonb_array_elements(v_worker_ids) as elem(value)
  ) <> jsonb_array_length(v_worker_ids) then
    raise exception using errcode = 'CDP22',
      message = 'Worker kimlikleri benzersiz olmalı.';
  end if;

  v_drained_text := p_drain_proof->>'drained_at';
  if v_drained_text is null or btrim(v_drained_text) = '' then
    raise exception using errcode = 'CDP22',
      message = 'Boşaltma zamanı zorunlu.';
  end if;

  begin
    v_drained_at := v_drained_text::timestamptz;
  exception
    when others then
      raise exception using errcode = 'CDP22',
        message = 'Boşaltma zamanı okunamadı.';
  end;

  if v_drained_at < v_state.reconciliation_started_at
    or v_drained_at > pg_catalog.clock_timestamp() then
    raise exception using errcode = 'CDP22',
      message = 'Boşaltma zamanı uzlaştırma aralığının dışında.';
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Any non-terminal started job is a possible in-flight DELETE. An expired
  -- lease does not prove otherwise; the operator must complete it, fail it and
  -- quarantine it, or quarantine it explicitly.
  if exists (
    select 1
    from public.admin_asset_cleanup_jobs as j
    where j.completed_at is null
      and j.skipped_at is null
      and j.quarantined_at is null
      and j.started_at is not null
  ) then
    raise exception using errcode = 'CDP22',
      message = 'Başlamış bir temizlik işi hâlâ etkin; kapanış kanıtlanamaz.';
  end if;

  -- Invalidate any claim token that was still left over before clearing the
  -- flag, so it cannot start work after finish.
  perform private.catalog_release_unstarted_cleanup_claims(v_now);

  update public.catalog_publish_state
     set reconciliation_required = false,
         reconciliation_started_at = null,
         reconciliation_started_by = null,
         reconciliation_note = null
   where id = 1;

  insert into public.admin_audit_logs
    (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'catalog.reconcile',
    'catalog_release',
    coalesce(v_state.current_release_id, 'generation:' || v_state.generation::text),
    jsonb_build_object(
      'phase', 'finish',
      'restore_epoch', v_state.restore_epoch,
      'generation', v_state.generation,
      'worker_ids', v_worker_ids,
      'drained_at', v_drained_text
    )
  );

  return query select v_state.restore_epoch, v_state.generation, v_now;
end;
$$;

revoke all on function public.finish_catalog_reconciliation(uuid, bigint, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_catalog_reconciliation(uuid, bigint, bigint, jsonb)
  to service_role;

-- The only way to close an ambiguous started job during reconciliation. It
-- preserves `started_at` and the tombstone as evidence and moves the decision
-- to a human, who must verify the object directly.
create function public.admin_quarantine_cleanup_job(
  p_job_id uuid,
  p_actor_id uuid,
  p_expected_started_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.admin_asset_cleanup_jobs%rowtype;
  v_now timestamptz;
  v_reason text;
  v_state public.catalog_publish_state%rowtype;
begin
  if p_job_id is null
    or p_actor_id is null
    or p_expected_started_at is null then
    raise exception using errcode = '22004',
      message = 'İş, aktör ve başlama zamanı zorunlu.';
  end if;

  perform private.require_admin_actor(p_actor_id);

  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  select *
    into v_state
    from public.catalog_publish_state as s
    where s.id = 1;

  if v_state.id is null or not v_state.reconciliation_required then
    raise exception using errcode = 'CDP21',
      message = 'Karantina yalnızca etkin uzlaştırma sırasında kullanılabilir.';
  end if;

  select *
    into v_job
    from public.admin_asset_cleanup_jobs as j
    where j.id = p_job_id
    for update;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'Temizlik işi bulunamadı.';
  end if;

  if v_job.completed_at is not null
    or v_job.skipped_at is not null
    or v_job.quarantined_at is not null
    or v_job.started_at is null then
    raise exception using errcode = 'CDP21',
      message = 'Yalnızca başlamış ve terminal olmayan bir iş karantinaya alınabilir.';
  end if;

  if v_job.started_at is distinct from p_expected_started_at then
    raise exception using errcode = 'CDP21',
      message = 'Başlama zamanı eşleşmiyor; iş değişmiş olabilir.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  update public.admin_asset_cleanup_jobs
     set quarantined_at = v_now,
         quarantine_reason = 'quiescence_unproven',
         worker_id = null,
         lease_expires_at = null,
         lease_token = null
   where id = p_job_id;

  insert into public.admin_asset_cleanup_events
    (job_id, bucket, path, attempt, outcome, error_code, error_detail, worker_id)
  values (
    v_job.id, v_job.bucket, v_job.path, v_job.attempts,
    'quarantined', 'reconciliation', left(v_reason, 500), v_job.worker_id
  );

  insert into public.admin_audit_logs
    (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'catalog.reconcile',
    'cleanup_job',
    v_job.id::text,
    jsonb_build_object(
      'phase', 'quarantine',
      'restore_epoch', v_state.restore_epoch,
      'reason', v_reason,
      'started_at', v_job.started_at,
      'worker_id', v_job.worker_id
    )
  );
end;
$$;

revoke all on function public.admin_quarantine_cleanup_job(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_quarantine_cleanup_job(uuid, uuid, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Cleanup lifecycle gates
-- ---------------------------------------------------------------------------

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

  -- P6: no new claim while reconciliation is live, even for a stranded row.
  if exists (
    select 1
    from public.catalog_publish_state as s
    where s.id = 1
      and s.reconciliation_required
  ) then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; temizlik işi alınamaz.';
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

  -- P6: starting is the attempt-consuming transition that precedes the
  -- DELETE. It is refused even for an idempotent retry of an already-started
  -- job, because nothing may begin while the drain is open.
  if exists (
    select 1
    from public.catalog_publish_state as s
    where s.id = 1
      and s.reconciliation_required
  ) then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; temizlik işi başlatılamaz.';
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

  -- P6: skip can auto-start an unstarted claim and always mutates the
  -- tombstone. Neither is allowed while reconciliation is open.
  if exists (
    select 1
    from public.catalog_publish_state as s
    where s.id = 1
      and s.reconciliation_required
  ) then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; temizlik işi atlanamaz.';
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

  -- P6: a false answer here authorises a Storage DELETE. While reconciliation
  -- is open the worker cannot obtain that answer at all.
  if exists (
    select 1
    from public.catalog_publish_state as s
    where s.id = 1
      and s.reconciliation_required
  ) then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; silme onayı verilemez.';
  end if;

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

-- ---------------------------------------------------------------------------
-- 7. Manifest assert gate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_catalog_manifest_claim(p_operation_id uuid, p_claim_token uuid, p_attempt_id uuid, p_actor_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_intent  public.catalog_publish_intents%rowtype;
  v_history public.catalog_publish_history%rowtype;
  v_state   public.catalog_publish_state%rowtype;
  v_now     timestamptz;
begin
  if p_operation_id is null
    or p_claim_token is null
    or p_attempt_id is null
    or p_actor_id is null then
    raise exception using errcode = '22004',
      message = 'İşlem, talep anahtarı, deneme ve aktör kimliği zorunlu.';
  end if;

  perform private.require_admin_actor(p_actor_id);

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- P6: a claim taken before reconciliation must not authorise a manifest
  -- write afterwards. Check before every idempotent return so no path bypasses
  -- the flag.
  if exists (
    select 1
    from public.catalog_publish_state as s
    where s.id = 1
      and s.reconciliation_required
  ) then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; manifest yazımı onaylanamaz.';
  end if;

  -- Classify from the append-only history first; a publish row requires its
  -- committed intent, a rollback row has none. This is the same rule the claim
  -- uses, so assert/release can never disagree with it.
  select *
  into v_history
  from public.catalog_publish_history as h
  where h.operation_id = p_operation_id;

  if found then
    if v_history.kind = 'publish' then
      begin
        select *
        into v_intent
        from public.catalog_publish_intents as i
        where i.operation_id = p_operation_id
        for share;
      exception
        when lock_not_available then
          raise exception using errcode = '55P03',
            message = 'Yayın niyeti kilidi zamanında alınamadı.';
      end;

      if not found then
        raise exception using errcode = 'P0001',
          message = 'Yayın geçmişi bulunamadı.';
      end if;

      if v_intent.attempt_id is distinct from p_attempt_id then
        raise exception using errcode = 'CDI03',
          message = 'Deneme kimliği yayın niyetiyle uyuşmuyor.';
      end if;

      if v_intent.status <> 'committed' then
        raise exception using errcode = 'CDP10',
          message = 'Manifest yalnızca tamamlanmış yayın için talep edilebilir.';
      end if;

      if v_history.release_id is distinct from v_intent.release_id then
        raise exception using errcode = 'P0001',
          message = 'Yayın geçmişi niyetle tutarsız.';
      end if;
    elsif v_history.kind = 'rollback' then
      if exists (
        select 1
        from public.catalog_publish_intents as i
        where i.operation_id = p_operation_id
      ) then
        raise exception using errcode = 'P0001',
          message = 'Yayın geçmişi niyetle tutarsız.';
      end if;
    else
      raise exception using errcode = 'P0001',
        message = 'Yayın geçmişi niyetle tutarsız.';
    end if;
  else
    begin
      select *
      into v_intent
      from public.catalog_publish_intents as i
      where i.operation_id = p_operation_id
      for share;
    exception
      when lock_not_available then
        raise exception using errcode = '55P03',
          message = 'Yayın niyeti kilidi zamanında alınamadı.';
    end;

    if not found then
      raise exception using errcode = 'CDP09',
        message = 'Yayın niyeti bulunamadı.';
    end if;

    if v_intent.attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Deneme kimliği yayın niyetiyle uyuşmuyor.';
    end if;

    if v_intent.status <> 'committed' then
      raise exception using errcode = 'CDP10',
        message = 'Manifest yalnızca tamamlanmış yayın için talep edilebilir.';
    end if;

    raise exception using errcode = 'P0001',
      message = 'Yayın geçmişi bulunamadı.';
  end if;

  if v_history.actor_id is distinct from p_actor_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayıncı tarafından kullanılmış.';
  end if;

  begin
    select *
    into v_state
    from public.catalog_publish_state as s
    where s.id = 1
    for share;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Katalog yayın kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Token first: a claim that was taken over is no longer ours, even if the
  -- rest of the row happens to look compatible.
  if v_state.manifest_claim_token is null
    or v_state.manifest_operation_id is distinct from p_operation_id
    or v_state.manifest_claim_token is distinct from p_claim_token then
    raise exception using errcode = 'CDP03',
      message = 'Manifest talebi bu işleme ait değil.';
  end if;

  if v_state.manifest_attempt_id is distinct from p_attempt_id then
    raise exception using errcode = 'CDI03',
      message = 'Manifest talebi bu deneme kimliğine ait değil.';
  end if;

  if v_state.manifest_claim_expires_at <= v_now then
    raise exception using errcode = 'CDP02',
      message = 'Manifest talebinin süresi dolmuş.';
  end if;

  if v_state.manifest_generation is distinct from v_history.generation then
    raise exception using errcode = 'P0001',
      message = 'Manifest talebi yayın nesliyle tutarsız.';
  end if;

  if v_state.generation is distinct from v_history.generation
    or v_state.current_release_id is distinct from v_history.release_id then
    raise exception using errcode = 'CDP06',
      message = 'Yayın nesli güncel değil; manifest yazılamaz.';
  end if;

  return true;
end;
$function$
;
