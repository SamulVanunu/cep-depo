-- P4 — atomic catalog publish and rollback.
--
-- PostgreSQL is the catalog pointer. A publish and a rollback are the only two
-- operations that move it, and both must move history, state metadata and the
-- pointer in one transaction, under the same global lock as the cleanup
-- tombstone writers.
--
-- ---------------------------------------------------------------------------
-- Publish
-- ---------------------------------------------------------------------------
--
-- `commit_catalog_publish()` keeps its lease/intent contract unchanged. The
-- only addition is `pg_advisory_xact_lock(20261101, 1)` after authorisation and
-- the transaction-local 5 s lock budget, before the intent row lock. The
-- release id has already been validated as a safe path segment by then, so the
-- tombstone/path guard checks precede the first row lock. The global lock is
-- the same exclusive lock every tombstone writer takes, which closes the race
-- between a catalog commit and a concurrent cleanup enqueue.
--
-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--
-- `commit_catalog_rollback()` re-points the DB ledger at an immutable release
-- that is still retained. It never writes or deletes Storage: the producer
-- uploads the target release's documents when it first publishes them, and a
-- rollback only changes which retained generation clients resolve through the
-- pointer.
--
-- A rollback is committed only when all of the following hold:
--
--   * the caller is an admin (the same gate every catalog RPC uses);
--   * the operation id does not already belong to another rollback;
--   * the expected generation is the live one (optimistic CAS);
--   * the pointer and the append-only history are internally consistent
--     (same head row, no generation gap) — otherwise CDP15;
--   * the target has a `publish` history row (a release cannot be rolled back
--     to before it was ever published);
--   * the target release appears in the retained window
--     `[greatest(0, generation - 4), generation]` — five generations, the same
--     contract `get_catalog_pointer()` publishes;
--   * the target's original commit intent is still `committed` and its sealed
--     `payload_digest` equals the digest supplied by the caller.
--
-- The digest is the proof of the immutable documents. The caller downloads
-- `releases/{id}/apps.json` and `releases/{id}/categories.json`, rebuilds the
-- canonical payload exactly as the producer sealed it and passes the digest.
-- A missing, truncated or modified file produces a different digest and the
-- rollback is refused with CDP13. The database cannot read Storage bytes; it
-- proves that the bytes the caller verified are the bytes that were published.
--
-- A successful rollback appends a `rollback` history row at generation + 1,
-- copying generated_at/app_count/category_count from the target's publish row,
-- so `get_catalog_pointer()` stays consistent with its head row. The pointer
-- update and the audit row happen in the same transaction.
--
-- Repeated rollback:
--   * the same operation id replays the recorded result (idempotent, no new
--     generation);
--   * a different operation id to the same retained release advances the
--     generation again and appends another rollback row. History remains a
--     contiguous 1..N ledger, and the release is retained as long as any of
--     its rows is inside the window.
--
-- ---------------------------------------------------------------------------
-- Manifest claim generalisation
-- ---------------------------------------------------------------------------
--
-- The mutable root `manifest.json` is written after the DB commit. Its claim
-- proves "my operation is still the live generation" before the upload. A
-- publish has a committed intent to prove ownership; a rollback has only its
-- append-only history row. The claim/assert/release functions therefore branch:
--
--   * an intent exists  -> today's committed-publish path, unchanged;
--   * no intent exists  -> the operation must be a `rollback` history row.
--
-- Both paths store the same claim columns and use the same live-pointer fence
-- (`state.generation` and `state.current_release_id` must match the history
-- row), so an older publisher/rollbacker can never restore a stale manifest.
--
-- SQLSTATEs added here:
--   CDP11 rollback_target_missing   no publish history for the target
--   CDP12 rollback_target_retired   target outside the retention window
--   CDP13 rollback_proof_failed     intent/digest proof missing or mismatched
--   CDP15 pointer_state_invalid     pointer and history disagree (reused)
--
-- Existing CDP04 (maintenance), CDP05 (operation conflict), CDP06 (generation
-- conflict), CDP09 (no operation), CDP10 (not committed) and 55P03 (lock
-- timeout) keep their meanings.

-- ---------------------------------------------------------------------------
-- commit_catalog_publish: join the global lock protocol
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
  -- missing attempt never reaches the intent gate or the row lock. The release
  -- id check is also the path guard: only a single safe segment can become
  -- `releases/{id}/...`.
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

  -- 3b. Global exclusive lock. It is the same key every tombstone writer uses
  -- and it is taken before the first row lock, so a commit can never race a
  -- cleanup enqueue. Path validation above already happened.
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  -- 4. Intent row, first in the row lock order and held exclusively for the
  -- whole call. Commit is the only writer of this row among the lease/commit
  -- RPCs, so it takes the write lock up front instead of upgrading later (see
  -- the S6 header: a FOR SHARE upgrade is the deadlock this avoids).
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
  -- that contradicts the seal is refused without taking the state row lock.
  -- The intent row is ours exclusively, so these values cannot move afterwards.
  if v_intent.attempt_id is distinct from p_attempt_id then
    raise exception using errcode = 'CDI03',
      message = 'Deneme kimliği mühürlenmiş yayın niyetiyle uyuşmuyor.';
  end if;

  if v_intent.release_id is distinct from p_release_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
  end if;

  -- 7. Publish-state row, second in the row lock order. Every commit serialises
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

revoke all on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- commit_catalog_rollback
-- ---------------------------------------------------------------------------

create or replace function public.commit_catalog_rollback(
  p_operation_id uuid,
  p_actor_id uuid,
  p_target_release_id text,
  p_expected_generation bigint,
  p_target_payload_digest text
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
  v_head public.catalog_publish_history%rowtype;
  v_history public.catalog_publish_history%rowtype;
  v_publish public.catalog_publish_history%rowtype;
  v_intent public.catalog_publish_intents%rowtype;
  v_now timestamptz;
  v_floor bigint;
  v_generation bigint;
  v_committed_at timestamptz;
  v_rows bigint;
  v_max bigint;
  v_constraint text;
begin
  -- 1. Parameter and path guard. The target release id must be a single safe
  -- path segment, and the digest is the lowercase SHA-256 the producer uses.
  if p_operation_id is null
    or p_actor_id is null
    or p_target_release_id is null
    or p_expected_generation is null
    or p_target_payload_digest is null then
    raise exception using errcode = '22004',
      message = 'Tüm geri alma parametreleri zorunlu.';
  end if;

  if p_expected_generation < 0 then
    raise exception using errcode = '22023',
      message = 'Beklenen nesil negatif olamaz.';
  end if;

  if p_expected_generation >= 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Beklenen nesil üst sınıra çok yakın.';
  end if;

  if p_target_release_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception using errcode = '22023',
      message = 'Geri alınacak yayın kimliği geçersiz.';
  end if;

  if p_target_payload_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023',
      message = 'Yayın içeriği özeti geçersiz.';
  end if;

  -- 2. Authorisation before any row read.
  perform private.require_admin_actor(p_actor_id);

  -- 3. Lock budget and the same global exclusive lock as publish and the
  -- tombstone writers. Taken before the first row lock.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  -- 4. Replay lookup. The global lock serialises writers, and history is
  -- append-only, so this read cannot race another catalog commit. The leak-free
  -- identity of a rollback is operation + actor + target + proof.
  select *
  into v_history
  from public.catalog_publish_history as h
  where h.operation_id = p_operation_id;

  if found then
    if v_history.kind <> 'rollback'
      or v_history.actor_id is distinct from p_actor_id
      or v_history.release_id is distinct from p_target_release_id then
      raise exception using errcode = 'CDP05',
        message = 'İşlem kimliği farklı bir geri alma ile zaten kullanılmış.';
    end if;

    -- Same proof on replay: a retry carrying different bytes is a conflict,
    -- not a result. The original publish intent is the immutable record.
    select *
    into v_publish
    from public.catalog_publish_history as h
    where h.release_id = p_target_release_id
      and h.kind = 'publish';

    if not found then
      raise exception using errcode = 'CDP13',
        message = 'Geri alınacak yayının içerik kaydı doğrulanamadı.';
    end if;

    select *
    into v_intent
    from public.catalog_publish_intents as i
    where i.operation_id = v_publish.operation_id;

    if not found
      or v_intent.status <> 'committed'
      or v_intent.payload_digest is null
      or v_intent.payload_digest is distinct from p_target_payload_digest then
      raise exception using errcode = 'CDP13',
        message = 'Geri alınacak yayının içerik kaydı doğrulanamadı.';
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

  -- 4b. An operation id that already owns a publish intent belongs to publish,
  -- not rollback. Refuse before the state lock so a colliding caller cannot
  -- advance the generation while the publisher's intent is still live.
  if exists (
    select 1
    from public.catalog_publish_intents as i
    where i.operation_id = p_operation_id
  ) then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
  end if;

  -- 5. Publish-state row is the only row lock this RPC takes.
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

  v_now := pg_catalog.clock_timestamp();

  -- 6. Maintenance owns the state row while its lock is live.
  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    raise exception using errcode = 'CDP04',
      message = 'Bakım kilidi etkin, geri alma tamamlanamaz.';
  end if;

  -- 7. Fail closed if the pointer and the append-only ledger disagree. A
  -- rollback must never build a new head on a corrupt base.
  if v_state.generation = 0 then
    raise exception using errcode = 'CDP11',
      message = 'Geri alınacak yayın bulunamadı.';
  end if;

  select *
  into v_head
  from public.catalog_publish_history as h
  where h.generation = v_state.generation;

  if not found then
    raise exception using errcode = 'CDP15',
      message = 'Katalog pointer''ının head geçmiş satırı yok.';
  end if;

  if v_head.release_id is distinct from v_state.current_release_id
    or v_head.generated_at is distinct from v_state.generated_at
    or v_head.app_count is distinct from v_state.app_count
    or v_head.category_count is distinct from v_state.category_count then
    raise exception using errcode = 'CDP15',
      message = 'Katalog pointer''ı head geçmiş satırıyla uyuşmuyor.';
  end if;

  select count(*), max(h.generation)
  into v_rows, v_max
  from public.catalog_publish_history as h;

  if v_max is distinct from v_state.generation
    or v_rows <> v_state.generation then
    raise exception using errcode = 'CDP15',
      message = 'Katalog geçmişinde nesil boşluğu var.';
  end if;

  -- 8. Optimistic compare-and-set on the generation the caller observed.
  if v_state.generation <> p_expected_generation then
    raise exception using errcode = 'CDP06',
      message = 'Beklenen nesil güncel değil.';
  end if;

  -- 9. The target must have been published at least once. The partial unique
  -- index guarantees one publish row per release.
  select *
  into v_publish
  from public.catalog_publish_history as h
  where h.release_id = p_target_release_id
    and h.kind = 'publish';

  if not found then
    raise exception using errcode = 'CDP11',
      message = 'Geri alınacak yayın bulunamadı.';
  end if;

  -- 10. Five retained generations, the same window get_catalog_pointer()
  -- publishes. A release is retained when any of its rows is in the window,
  -- so a release that was itself rolled back to recently stays eligible.
  v_floor := greatest(
    0::bigint,
    v_state.generation
      - (private.catalog_retention_generations() - 1)::bigint
  );

  if not exists (
    select 1
    from public.catalog_publish_history as h
    where h.release_id = p_target_release_id
      and h.generation >= v_floor
      and h.generation <= v_state.generation
  ) then
    raise exception using errcode = 'CDP12',
      message = 'Geri alınacak yayın saklama penceresinde değil.';
  end if;

  -- 11. Immutable proof. The publish intent still holds the digest of the
  -- sealed documents (the payload bytes are dropped on commit, the digest is
  -- not). A missing/odd intent or a different digest means the caller cannot
  -- prove the files it read are the files that were published.
  select *
  into v_intent
  from public.catalog_publish_intents as i
  where i.operation_id = v_publish.operation_id;

  if not found
    or v_intent.status <> 'committed'
    or v_intent.payload_digest is null
    or v_intent.payload_digest is distinct from p_target_payload_digest then
    raise exception using errcode = 'CDP13',
      message = 'Geri alınacak yayının içerik kaydı doğrulanamadı.';
  end if;

  -- 12. New generation. The earlier bound check keeps this addition safe.
  v_generation := v_state.generation + 1;

  -- 13. History first, exactly like publish: it is the ledger and the source
  -- of the pointer metadata. The rollback row reuses the target's content
  -- metadata, never the caller's numbers.
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
      p_target_release_id,
      v_generation,
      'rollback',
      p_actor_id,
      v_publish.generated_at,
      v_publish.app_count,
      v_publish.category_count,
      pg_catalog.clock_timestamp()
    )
    returning h.generation, h.committed_at into v_generation, v_committed_at;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint = 'catalog_publish_history_operation_unique' then
        raise exception using errcode = 'CDP05',
          message = 'İşlem kimliği farklı bir geri alma ile zaten kullanılmış.';
      elsif v_constraint = 'catalog_publish_history_generation_unique' then
        raise exception using errcode = 'CDP06',
          message = 'Beklenen nesil güncel değil.';
      else
        raise;
      end if;
  end;

  -- 14. Move the pointer in the same transaction. Lease fields are left
  -- untouched on purpose: a publisher that still holds a lease will see the
  -- moved generation and terminalise its own intent as failed.
  update public.catalog_publish_state as s
  set
    generation = v_generation,
    current_release_id = p_target_release_id,
    generated_at = v_publish.generated_at,
    app_count = v_publish.app_count,
    category_count = v_publish.category_count
  where s.id = 1
    and s.generation = p_expected_generation;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception using errcode = 'CDP06',
      message = 'Beklenen nesil güncel değil.';
  end if;

  -- 15. Audit in the same transaction.
  insert into public.admin_audit_logs (
    actor_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    p_actor_id,
    'catalog.rollback',
    'catalog_release',
    p_target_release_id,
    pg_catalog.jsonb_build_object(
      'release_id', p_target_release_id,
      'generation', v_generation,
      'target_generation', v_publish.generation
    )
  );

  release_id := p_target_release_id;
  generation := v_generation;
  committed_at := v_committed_at;
  idempotent := false;
  outcome := 'committed';
  failure_code := null;
  return next;
end;
$$;

revoke all on function public.commit_catalog_rollback(
  uuid, uuid, text, bigint, text
) from public, anon, authenticated, service_role;

grant execute on function public.commit_catalog_rollback(
  uuid, uuid, text, bigint, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Manifest claim: publish intent OR rollback history
-- ---------------------------------------------------------------------------

create or replace function public.claim_catalog_manifest(
  p_operation_id uuid,
  p_attempt_id uuid,
  p_actor_id uuid,
  p_release_id text,
  p_claim_seconds integer default 60
)
returns table (
  claim_token uuid,
  claim_expires_at timestamptz,
  generation bigint,
  release_id text,
  generated_at timestamptz,
  app_count integer,
  category_count integer,
  idempotent boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_intent  public.catalog_publish_intents%rowtype;
  v_history public.catalog_publish_history%rowtype;
  v_state   public.catalog_publish_state%rowtype;
  v_now     timestamptz;
  v_token   uuid;
  v_expires_at timestamptz;
begin
  if p_operation_id is null
    or p_attempt_id is null
    or p_actor_id is null
    or p_release_id is null then
    raise exception using errcode = '22004',
      message = 'İşlem, deneme, aktör ve yayın kimliği zorunlu.';
  end if;

  if p_claim_seconds is null then
    raise exception using errcode = '22004',
      message = 'Talep süresi zorunlu.';
  end if;

  if p_claim_seconds < 30 or p_claim_seconds > 900 then
    raise exception using errcode = '22023',
      message = 'Talep süresi 30 ile 900 saniye arasında olmalı.';
  end if;

  if p_release_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception using errcode = '22023',
      message = 'Yayın kimliği geçersiz.';
  end if;

  -- Authorisation before any row read, matching every other publish RPC.
  perform private.require_admin_actor(p_actor_id);

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- 1. Classify the operation from the append-only history, which is the
  -- authoritative record. A publish row requires its committed intent; a
  -- rollback row has no intent by construction. Classifying from intent
  -- existence would misread a rollback whose operation id collides with an
  -- unrelated publish intent.
  select *
  into v_history
  from public.catalog_publish_history as h
  where h.operation_id = p_operation_id;

  if found then
    if v_history.kind = 'publish' then
      -- Publish path: the committed intent is the ownership proof. It is still
      -- the first row lock this RPC takes.
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
      -- Rollback path: the append-only row is the operation record; the claim
      -- token itself is the ownership proof. A stray intent sharing the id is
      -- a corrupt ledger, never a second ownership claim.
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
    -- No history yet: a publish may still be in progress, sealed or failed.
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

    -- A committed intent always has a history row.
    raise exception using errcode = 'P0001',
      message = 'Yayın geçmişi bulunamadı.';
  end if;

  if v_history.actor_id is distinct from p_actor_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayıncı tarafından kullanılmış.';
  end if;

  if v_history.release_id is distinct from p_release_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
  end if;

  -- 3. Publish-state row, second in the lock order.
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

  -- Read the clock only after the lock: a caller that waited must not be
  -- judged against the timestamp from before the wait.
  v_now := pg_catalog.clock_timestamp();

  -- 4. The old-publisher/old-rollbacker fence. Both halves of the pointer must
  -- still name this history row: a newer generation OR a different current
  -- release means this operation is superseded and may never restore its
  -- manifest.
  if v_state.generation is distinct from v_history.generation
    or v_state.current_release_id is distinct from v_history.release_id then
    raise exception using errcode = 'CDP06',
      message = 'Yayın nesli güncel değil; manifest yazılamaz.';
  end if;

  -- 5. Maintenance and a live publisher lease both block the write. Reuse the
  -- existing codes and precedence: maintenance first, then the lease.
  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    raise exception using errcode = 'CDP04',
      message = 'Bakım kilidi etkin, manifest talebi alınamaz.';
  end if;

  if v_state.publish_lock_token is not null
    and v_state.publish_lock_expires_at > v_now
    and (
      v_state.publish_operation_id is distinct from p_operation_id
      or v_state.publish_attempt_id is distinct from p_attempt_id
    ) then
    raise exception using errcode = 'CDP01',
      message = 'Yayın kilidi başka bir işlem tarafından tutuluyor.';
  end if;

  -- 6. Existing claim: idempotent for its owner, a conflict for a live holder
  -- of the same generation, and a safe takeover when expired or stale.
  if v_state.manifest_claim_token is not null then
    if v_state.manifest_operation_id = p_operation_id
      and v_state.manifest_attempt_id = p_attempt_id
      and v_state.manifest_generation = v_history.generation
      and v_state.manifest_claim_expires_at > v_now then
      return query
        select
          v_state.manifest_claim_token,
          v_state.manifest_claim_expires_at,
          v_history.generation,
          v_history.release_id,
          v_history.generated_at,
          v_history.app_count,
          v_history.category_count,
          true;
      return;
    end if;

    if v_state.manifest_generation > v_history.generation then
      raise exception using errcode = 'P0001',
        message = 'Manifest talebi yayın nesliyle tutarsız.';
    end if;

    if v_state.manifest_claim_expires_at > v_now
      and v_state.manifest_generation = v_history.generation
      and (
        v_state.manifest_operation_id is distinct from p_operation_id
        or v_state.manifest_attempt_id is distinct from p_attempt_id
      ) then
      raise exception using errcode = 'CDI04',
        message = 'Manifest talebi başka bir yayıncı tarafından tutuluyor.';
    end if;

    -- Expired (any generation) or live but generation-stale: take over.
  end if;

  v_token := pg_catalog.gen_random_uuid();
  v_expires_at := v_now + pg_catalog.make_interval(secs => p_claim_seconds);

  update public.catalog_publish_state
  set
    manifest_claim_token = v_token,
    manifest_claim_expires_at = v_expires_at,
    manifest_operation_id = p_operation_id,
    manifest_attempt_id = p_attempt_id,
    manifest_generation = v_history.generation
  where id = 1;

  return query
    select
      v_token,
      v_expires_at,
      v_history.generation,
      v_history.release_id,
      v_history.generated_at,
      v_history.app_count,
      v_history.category_count,
      false;
end;
$$;

create or replace function public.assert_catalog_manifest_claim(
  p_operation_id uuid,
  p_claim_token uuid,
  p_attempt_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.release_catalog_manifest_claim(
  p_operation_id uuid,
  p_claim_token uuid,
  p_attempt_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_intent  public.catalog_publish_intents%rowtype;
  v_history public.catalog_publish_history%rowtype;
  v_state   public.catalog_publish_state%rowtype;
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

  if v_state.manifest_claim_token is null then
    return false;
  end if;

  if v_state.manifest_operation_id is distinct from p_operation_id
    or v_state.manifest_claim_token is distinct from p_claim_token then
    raise exception using errcode = 'CDP03',
      message = 'Manifest talebi bu işleme ait değil.';
  end if;

  if v_state.manifest_attempt_id is distinct from p_attempt_id then
    raise exception using errcode = 'CDI03',
      message = 'Manifest talebi bu deneme kimliğine ait değil.';
  end if;

  -- Expiry is deliberately not checked: the owner may clean up after its own
  -- claim ran out, and a claim that was taken over fails the token check above.
  update public.catalog_publish_state
  set
    manifest_claim_token = null,
    manifest_claim_expires_at = null,
    manifest_operation_id = null,
    manifest_attempt_id = null,
    manifest_generation = null
  where id = 1;

  return true;
end;
$$;

revoke all on function public.claim_catalog_manifest(
  uuid, uuid, uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_catalog_manifest(
  uuid, uuid, uuid, text, integer
) to service_role;

revoke all on function public.assert_catalog_manifest_claim(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.assert_catalog_manifest_claim(
  uuid, uuid, uuid, uuid
) to service_role;

revoke all on function public.release_catalog_manifest_claim(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.release_catalog_manifest_claim(
  uuid, uuid, uuid, uuid
) to service_role;
