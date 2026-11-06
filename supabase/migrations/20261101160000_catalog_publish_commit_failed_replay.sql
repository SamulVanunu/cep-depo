-- B2 catalog publish failed-commit replay content check (A10.36 S6.1).
--
-- S6 made a commit that finds its intent sealed against a generation the state
-- row has left behind terminalise that intent as `failed` and return the
-- recorded outcome instead of raising. The replay branch, however, could only
-- compare what the failed intent still held: the attempt, the seal's release
-- and its base generation. The commit's own content — generated_at, app_count,
-- category_count and actor_id — was never stored, so a retry carrying
-- different content was answered with "this is your result" anyway. That is a
-- false idempotency claim: the caller could not distinguish its own retry from
-- a different payload that happened to reuse the operation id.
--
-- This migration closes that hole.
--
-- ---------------------------------------------------------------------------
-- What is stored, and where
-- ---------------------------------------------------------------------------
--
-- Four nullable columns on public.catalog_publish_intents:
--
--   failed_generated_at timestamptz
--   failed_app_count     integer
--   failed_category_count integer
--   failed_actor_id      uuid
--
-- They are nullable because an intent that seals or commits normally must not
-- carry them, and because every existing row predates them. They are written
-- by exactly one path: the stale-intent branch of commit_catalog_publish, in
-- the same UPDATE that sets status = 'failed'. The S3 table and trigger
-- contracts are untouched; this migration adds columns, constraints and one
-- guard trigger around them.
--
-- ---------------------------------------------------------------------------
-- Constraints: present, failed-only, complete, non-negative
-- ---------------------------------------------------------------------------
--
--   * catalog_publish_intents_failed_metadata_complete
--       all four null, or all four non-null. A partial record would let a
--       replay compare some fields and silently ignore the rest.
--   * catalog_publish_intents_failed_metadata_status
--       metadata only on a failed row, so a sealed or committed intent cannot
--       use the columns as scratch space.
--   * catalog_publish_intents_failed_counts_nonneg
--       neither count is negative, matching the parameter validation the
--       commit already performs.
--
-- None of these can express "written only by the commit", because a CHECK sees
-- one row, not the statement that wrote it. The guard trigger below does.
--
-- ---------------------------------------------------------------------------
-- The guard trigger: a recorded failure is immutable
-- ---------------------------------------------------------------------------
--
-- catalog_publish_intents_guard_failed_metadata runs BEFORE UPDATE. It enforces
-- two rules:
--
--   * once a row is failed, the four columns can never change. The record is
--     evidence of what was refused; rewriting it would let a later replay
--     "match" content the refused commit never carried.
--   * metadata can be introduced only by a sealed -> failed transition. That is
--     the commit's stale path and nothing else, so an in_progress intent cannot
--     be given a fabricated failure record.
--
-- The trigger is BEFORE UPDATE only. A direct INSERT of a failed row still has
-- to satisfy the CHECKs, which is exactly what the tests exercise.
--
-- ---------------------------------------------------------------------------
-- The replay contract
-- ---------------------------------------------------------------------------
--
-- A failed intent replays only when attempt, release, base generation,
-- generated_at, app_count, category_count and actor_id all match the record;
-- any difference is CDP05. A failed intent with no record (terminalised by some
-- other path) cannot be verified, so it is refused with CDP05 rather than
-- answered — fail closed, never guess. Authorisation still runs before the
-- replay lookup, so an unauthorised actor cannot read the result at all.
--
-- The replay returns the stored failure code with idempotent = true and never
-- touches the state row, the generation, the payload or the audit log.
--
-- ---------------------------------------------------------------------------
-- Delivery shape
-- ---------------------------------------------------------------------------
--
-- The commit function keeps its nine-argument signature and its return type, so
-- it is replaced with CREATE OR REPLACE rather than dropped and recreated: the
-- ACL is preserved and re-asserted below. Nothing else in the commit changes;
-- the ordering, lease checks, committed replay, audit and atomicity are the S6
-- contract and are carried over verbatim.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.catalog_publish_intents
  add column failed_generated_at timestamptz,
  add column failed_app_count integer,
  add column failed_category_count integer,
  add column failed_actor_id uuid;

comment on column public.catalog_publish_intents.failed_generated_at is
  'generated_at of the commit refused by the stale-intent path; null unless the commit recorded the failure.';
comment on column public.catalog_publish_intents.failed_app_count is
  'app_count of the commit refused by the stale-intent path; null unless the commit recorded the failure.';
comment on column public.catalog_publish_intents.failed_category_count is
  'category_count of the commit refused by the stale-intent path; null unless the commit recorded the failure.';
comment on column public.catalog_publish_intents.failed_actor_id is
  'actor_id of the commit refused by the stale-intent path; null unless the commit recorded the failure.';

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

alter table public.catalog_publish_intents
  add constraint catalog_publish_intents_failed_metadata_complete check (
    (
      failed_generated_at is null
      and failed_app_count is null
      and failed_category_count is null
      and failed_actor_id is null
    )
    or (
      failed_generated_at is not null
      and failed_app_count is not null
      and failed_category_count is not null
      and failed_actor_id is not null
    )
  ),
  add constraint catalog_publish_intents_failed_metadata_status check (
    status = 'failed'
    or (
      failed_generated_at is null
      and failed_app_count is null
      and failed_category_count is null
      and failed_actor_id is null
    )
  ),
  add constraint catalog_publish_intents_failed_counts_nonneg check (
    (failed_app_count is null or failed_app_count >= 0)
    and (failed_category_count is null or failed_category_count >= 0)
  );

-- ---------------------------------------------------------------------------
-- Guard trigger
-- ---------------------------------------------------------------------------

create function private.catalog_publish_intent_guard_failed_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'failed' then
    -- The record is evidence. Once written, it is never rewritten, even to
    -- another internally consistent set of values.
    if new.failed_generated_at is distinct from old.failed_generated_at
      or new.failed_app_count is distinct from old.failed_app_count
      or new.failed_category_count is distinct from old.failed_category_count
      or new.failed_actor_id is distinct from old.failed_actor_id then
      raise exception using errcode = '55000',
        message = 'Kaydedilmiş yayın hatası değiştirilemez.';
    end if;

    return new;
  end if;

  -- Introducing a record is reserved for the transition that refuses a sealed
  -- operation. A CHECK cannot see the old status, so it cannot enforce this.
  -- A row that is already failed never reaches this branch: the rule above owns
  -- it in both directions, including erasing the record.
  if new.status = 'failed'
    and (
      new.failed_generated_at is not null
      or new.failed_app_count is not null
      or new.failed_category_count is not null
      or new.failed_actor_id is not null
    )
    and old.status is distinct from 'sealed' then
    raise exception using errcode = '55000',
      message = 'Yayın hatası kaydı yalnızca mühürlü niyet reddedilirken yazılabilir.';
  end if;

  return new;
end;
$$;

create trigger catalog_publish_intents_guard_failed_metadata
before update on public.catalog_publish_intents
for each row
execute function private.catalog_publish_intent_guard_failed_metadata();

-- Trigger functions are invoked by the trigger machinery, never by a client.
revoke all on function private.catalog_publish_intent_guard_failed_metadata()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The commit function
-- ---------------------------------------------------------------------------

create or replace function public.commit_catalog_publish(
  p_operation_id uuid,
  p_lease_token uuid,
  p_actor_id uuid,
  p_expected_generation bigint,
  p_release_id text,
  p_generated_at timestamptz,
  p_app_count integer,
  p_category_count integer,
  p_attempt_id uuid
)
returns table (
  release_id text,
  generation bigint,
  committed_at timestamptz,
  idempotent boolean,
  outcome text,
  failure_code text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_intent public.catalog_publish_intents%rowtype;
  v_history public.catalog_publish_history%rowtype;
  v_now timestamptz;
  v_generation bigint;
  v_committed_at timestamptz;
  v_rows bigint;
  v_constraint text;
begin
  -- 1. Parameter validation. Nothing below runs for a malformed call, so a
  -- missing attempt never reaches the intent gate or the row lock.
  if p_operation_id is null
    or p_lease_token is null
    or p_actor_id is null
    or p_expected_generation is null
    or p_release_id is null
    or p_generated_at is null
    or p_app_count is null
    or p_category_count is null
    or p_attempt_id is null then
    raise exception using errcode = '22004',
      message = 'Tüm commit parametreleri zorunlu.';
  end if;

  if p_expected_generation < 0 then
    raise exception using errcode = '22023',
      message = 'Beklenen nesil negatif olamaz.';
  end if;

  -- generation + 1 must fit in bigint; reject the top value before it overflows.
  if p_expected_generation >= 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Beklenen nesil üst sınıra çok yakın.';
  end if;

  if p_app_count < 0 or p_category_count < 0 then
    raise exception using errcode = '22023',
      message = 'Yayın sayaçları negatif olamaz.';
  end if;

  if p_release_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception using errcode = '22023',
      message = 'Yayın kimliği geçersiz.';
  end if;

  -- timestamptz accepts 'infinity'; storing it would make a projected manifest
  -- unparseable for every consumer (Date.parse returns NaN).
  if not pg_catalog.isfinite(p_generated_at) then
    raise exception using errcode = '22023',
      message = 'Üretim zamanı sonlu olmalı.';
  end if;

  -- 2. Authorisation before any row read, including the replay lookup.
  perform private.require_admin_actor(p_actor_id);

  -- 3. Per-call lock timeout; the caller's session setting is untouched.
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- 4. Intent row, first in the lock order and held exclusively for the whole
  -- call. Commit is the only writer of this row among the lease/commit RPCs,
  -- so it takes the write lock up front instead of upgrading later (see the
  -- header: a FOR SHARE upgrade is the deadlock this avoids).
  begin
    select *
    into v_intent
    from public.catalog_publish_intents as i
    where i.operation_id = p_operation_id
    for update;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Yayın niyeti kilidi zamanında alınamadı.';
  end;

  if not found then
    raise exception using errcode = 'CDP09',
      message = 'Yayın niyeti bulunamadı.';
  end if;

  -- 5. Terminal intents are replay-only. Both branches still verify the
  -- attempt, so a second attempt of the same operation cannot read the first
  -- one's result, and authorisation already ran, so it cannot bypass that.
  if v_intent.status = 'committed' then
    if v_intent.attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Deneme kimliği mühürlenmiş yayın niyetiyle uyuşmuyor.';
    end if;

    select *
    into v_history
    from public.catalog_publish_history as h
    where h.operation_id = p_operation_id;

    if not found then
      raise exception using errcode = 'P0001',
        message = 'Yayın geçmişi bulunamadı.';
    end if;

    if v_history.release_id is distinct from p_release_id
      or v_history.generated_at is distinct from p_generated_at
      or v_history.app_count is distinct from p_app_count
      or v_history.category_count is distinct from p_category_count
      or v_history.actor_id is distinct from p_actor_id
      or v_history.kind is distinct from 'publish' then
      raise exception using errcode = 'CDP05',
        message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
    end if;

    release_id := v_history.release_id;
    generation := v_history.generation;
    committed_at := v_history.committed_at;
    idempotent := true;
    outcome := 'committed';
    failure_code := null;
    return next;
    return;
  end if;

  if v_intent.status = 'failed' then
    if v_intent.attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Deneme kimliği terminal yayın niyetiyle uyuşmuyor.';
    end if;

    -- S6.1: a failed intent is replayable only when the refusal that produced
    -- it recorded the commit it refused. A failure written by another path has
    -- no such record; answering it with a result would assert a match nobody
    -- can verify, so it is refused instead of guessed.
    if v_intent.failed_generated_at is null
      or v_intent.failed_app_count is null
      or v_intent.failed_category_count is null
      or v_intent.failed_actor_id is null then
      raise exception using errcode = 'CDP05',
        message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
    end if;

    -- The replay must carry the same content the refused commit carried. The
    -- attempt was checked above, so another attempt of this operation still
    -- cannot read this result; the release and the base generation were
    -- already compared in S6 and remain part of the identity.
    if v_intent.release_id is distinct from p_release_id
      or v_intent.expected_generation is distinct from p_expected_generation
      or v_intent.failed_generated_at is distinct from p_generated_at
      or v_intent.failed_app_count is distinct from p_app_count
      or v_intent.failed_category_count is distinct from p_category_count
      or v_intent.failed_actor_id is distinct from p_actor_id then
      raise exception using errcode = 'CDP05',
        message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
    end if;

    release_id := v_intent.release_id;
    generation := null;
    committed_at := null;
    idempotent := true;
    outcome := 'failed';
    failure_code := v_intent.failure_code;
    return next;
    return;
  end if;

  if v_intent.status <> 'sealed' then
    -- in_progress: an operation that never sealed has no bytes to publish.
    raise exception using errcode = 'CDP10',
      message = 'Yayın niyeti mühürlenmeden tamamlanamaz.';
  end if;

  -- 6. The sealed content is compared before the state row is touched: a call
  -- that contradicts the seal is refused without taking the global lock. The
  -- intent row is ours exclusively, so these values cannot move afterwards.
  if v_intent.attempt_id is distinct from p_attempt_id then
    raise exception using errcode = 'CDI03',
      message = 'Deneme kimliği mühürlenmiş yayın niyetiyle uyuşmuyor.';
  end if;

  if v_intent.release_id is distinct from p_release_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
  end if;

  -- 7. Publish-state row, second in the lock order. Every commit serialises
  -- here, so history, pointer, metadata and generation stay a single ledger.
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

  -- Read the clock only after the lock is granted: a caller that waited for
  -- the row must not be judged against the timestamp from before the wait.
  v_now := pg_catalog.clock_timestamp();

  -- 8. A live maintenance lock blocks publication before the lease checks, so
  -- a publisher whose lease was taken over by maintenance reports "maintenance"
  -- (CDP04) instead of a misleading "invalid token" (CDP03).
  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    raise exception using errcode = 'CDP04',
      message = 'Bakım kilidi etkin, yayın tamamlanamaz.';
  end if;

  -- 9. Lease ownership: operation id and token must both be the live pair.
  if v_state.publish_lock_token is null
    or v_state.publish_operation_id is distinct from p_operation_id
    or v_state.publish_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Yayın kilidi bu işleme ait değil.';
  end if;

  -- 10. Expiry, measured with the timestamp taken under the lock.
  if v_state.publish_lock_expires_at <= v_now then
    raise exception using errcode = 'CDP02',
      message = 'Yayın kilidinin süresi dolmuş.';
  end if;

  -- 11. Second attempt witness: the state row must name the same attempt the
  -- sealed intent names. A lease taken without an attempt cannot be adopted by
  -- one (S5's boundary), and a taken-over lease fails here too.
  if v_state.publish_attempt_id is distinct from p_attempt_id then
    raise exception using errcode = 'CDI03',
      message = 'Yayın kilidi bu deneme kimliğine ait değil.';
  end if;

  -- 12. The intent's base generation is the world it was sealed against. If
  -- the state row has moved on, another operation published first: this
  -- operation is over. Record that, do not re-base it.
  if v_intent.expected_generation <> v_state.generation then
    -- The lease and its attempt die with the operation. Leaving them would
    -- block every other publisher until the expiry for no reason.
    update public.catalog_publish_state as s
    set
      publish_lock_token = null,
      publish_lock_expires_at = null,
      publish_operation_id = null,
      publish_attempt_id = null
    where s.id = 1;

    -- Status, the cause and the refused commit's content move together. The
    -- content is what makes a later replay verifiable: S6 could only compare
    -- the seal's release and base generation, so a replay was free to carry
    -- different counts, a different generated_at or a different actor and
    -- still be answered with this result. S3's guard freezes the seal
    -- metadata (it remains the record of what was refused) and the
    -- drop-payload trigger removes the bytes; S3's require-payload check only
    -- constrains sealed rows. One statement, so the record and the transition
    -- commit or roll back together.
    update public.catalog_publish_intents as i
    set
      status = 'failed',
      failure_code = 'CDP06',
      failure_reason = 'Nesil başka bir yayın tarafından ilerletildi.',
      failed_generated_at = p_generated_at,
      failed_app_count = p_app_count,
      failed_category_count = p_category_count,
      failed_actor_id = p_actor_id
    where i.operation_id = p_operation_id;

    get diagnostics v_rows = row_count;

    if v_rows <> 1 then
      raise exception using errcode = 'P0001',
        message = 'Yayın niyeti terminal duruma geçirilemedi.';
    end if;

    release_id := v_intent.release_id;
    generation := null;
    committed_at := null;
    idempotent := false;
    outcome := 'failed';
    failure_code := 'CDP06';
    return next;
    return;
  end if;

  -- 13. Compare-and-set on the generation the caller leased. The intent is
  -- still at the live generation here, so a mismatch is the caller's error,
  -- not a stale intent: raise, and leave the seal and its payload intact.
  if v_state.generation <> p_expected_generation then
    raise exception using errcode = 'CDP06',
      message = 'Beklenen nesil güncel değil.';
  end if;

  -- 14. A release may be published fresh exactly once. The row lock makes this
  -- check race-free; the partial unique index below is the backstop.
  if exists (
    select 1
    from public.catalog_publish_history as h
    where h.release_id = p_release_id
      and h.kind = 'publish'
  ) then
    raise exception using errcode = 'CDP07',
      message = 'Bu yayın kimliği daha önce yayınlanmış.';
  end if;

  -- 15. History first: it is the idempotency record and the generation ledger.
  -- RETURNING is the source of truth; the value is never recomputed afterwards.
  begin
    insert into public.catalog_publish_history as h (
      operation_id,
      release_id,
      generation,
      kind,
      actor_id,
      generated_at,
      app_count,
      category_count,
      committed_at
    )
    values (
      p_operation_id,
      p_release_id,
      p_expected_generation + 1,
      'publish',
      p_actor_id,
      p_generated_at,
      p_app_count,
      p_category_count,
      pg_catalog.clock_timestamp()
    )
    returning h.generation, h.committed_at into v_generation, v_committed_at;
  exception
    when unique_violation then
      -- The pre-checks above are race-free under the row lock; this mapping is
      -- a regression backstop. Each unique index is reported by its own name,
      -- including catalog_publish_history_publish_release_unique, which is a
      -- partial unique index rather than a table constraint. An unknown name
      -- is re-raised, never swallowed.
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint = 'catalog_publish_history_operation_unique' then
        raise exception using errcode = 'CDP05',
          message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
      elsif v_constraint = 'catalog_publish_history_generation_unique' then
        raise exception using errcode = 'CDP06',
          message = 'Beklenen nesil güncel değil.';
      elsif v_constraint = 'catalog_publish_history_publish_release_unique' then
        raise exception using errcode = 'CDP07',
          message = 'Bu yayın kimliği daha önce yayınlanmış.';
      else
        raise;
      end if;
  end;

  -- 16. Promote the pointer and metadata, and clear the lease and its attempt
  -- in the same statement: locks_exclusive then lets maintenance take the row
  -- immediately. The generation predicate is redundant under FOR UPDATE; it is
  -- kept as a second line of defence against a future change that drops the
  -- lock.
  update public.catalog_publish_state as s
  set
    generation = v_generation,
    current_release_id = p_release_id,
    generated_at = p_generated_at,
    app_count = p_app_count,
    category_count = p_category_count,
    publish_lock_token = null,
    publish_lock_expires_at = null,
    publish_operation_id = null,
    publish_attempt_id = null
  where s.id = 1
    and s.generation = p_expected_generation;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception using errcode = 'CDP06',
      message = 'Beklenen nesil güncel değil.';
  end if;

  -- 17. The seal becomes the record. S3's transition guard permits
  -- sealed -> committed, its drop-payload trigger removes the bytes, and the
  -- row already holds the attempt that produced them.
  update public.catalog_publish_intents as i
  set status = 'committed'
  where i.operation_id = p_operation_id;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception using errcode = 'P0001',
      message = 'Yayın niyeti tamamlanmış olarak işaretlenemedi.';
  end if;

  -- 18. Audit in the same transaction. A failure here aborts the commit and
  -- rolls history, state and intent back together.
  insert into public.admin_audit_logs (
    actor_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    p_actor_id,
    'catalog.publish',
    'catalog_release',
    p_release_id,
    pg_catalog.jsonb_build_object(
      'release_id', p_release_id,
      'generation', v_generation
    )
  );

  -- 19. Fresh result.
  release_id := p_release_id;
  generation := v_generation;
  committed_at := v_committed_at;
  idempotent := false;
  outcome := 'committed';
  failure_code := null;
  return next;
end;
$$;

-- Only the service role may commit a publication. CREATE OR REPLACE keeps the
-- existing ACL, but the contract is re-asserted so a later drift in the
-- database cannot silently widen it.
revoke all on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer, uuid
) to service_role;
