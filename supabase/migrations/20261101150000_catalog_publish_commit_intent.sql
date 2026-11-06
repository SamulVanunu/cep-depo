-- B2 catalog publish commit ↔ intent ↔ attempt integration (A10.36 S6).
--
-- S3 gave an operation a durable intent, S4 let it seal byte-exact bytes under
-- an attempt id, and S5 bound the publish lease to that attempt. The commit was
-- still the old shape: it knew an operation and a token, and nothing about the
-- seal that produced the bytes it was about to publish. This migration makes
-- the commit prove all of them together, in one transaction:
--
--   * the operation has a sealed intent,
--   * the attempt presenting the commit is the one that sealed it *and* the
--     one holding the lease,
--   * the release the caller names is the release the intent froze,
--   * the generation the caller leased is still the live generation,
--   * the release has never been published before,
--
-- and only then does generation, pointer, metadata, history and audit move.
--
-- ---------------------------------------------------------------------------
-- Why the old eight-argument signature is dropped, not kept
-- ---------------------------------------------------------------------------
--
-- An eight-argument overload would be a complete bypass: a caller that omitted
-- the attempt would reach every write above the intent gate and publish bytes
-- it never sealed. There is no "legacy commit" to preserve, because the legacy
-- producer is being migrated to present its attempt (a later stage). Leaving
-- the old signature would therefore keep the hole open rather than keep a
-- contract alive. It is dropped, and the nine-argument signature is the only
-- one that exists.
--
-- Consequence, stated plainly: a producer still calling the eight-argument
-- form fails with "function does not exist" (PostgREST: PGRST202) until it is
-- integrated. That is a loud, immediate failure at the call site, not a silent
-- publish without an attempt.
--
-- ---------------------------------------------------------------------------
-- Lock order: the S5 rule, with the one mode change commit needs
-- ---------------------------------------------------------------------------
--
-- S5 fixed the order for every function that touches both tables:
--
--   catalog_publish_intents  (by operation_id)
--     -> catalog_publish_state (id = 1, FOR UPDATE)
--
-- and commit must not invert it. It does read the intent first, and it locks
-- it FOR UPDATE rather than FOR SHARE. That mode is deliberate and is the
-- reason this is safe:
--
--   * commit is the one function that writes the intent row (sealed ->
--     committed, or sealed -> failed). A writer needs FOR UPDATE, and taking
--     FOR SHARE first and upgrading later is a deadlock, not a refinement:
--     a concurrent renew for the same operation can hold FOR SHARE on the
--     intent and wait for the state row this commit already owns, while the
--     upgrade waits for that FOR SHARE.
--   * Taking FOR UPDATE up front keeps every waiter on this row before it
--     holds anything else. A commit that waits for the intent holds no state
--     lock; a renew/assert/release that waits for the intent holds no state
--     lock. The only waiters on the state row are transactions that already
--     own their intent lock, and intents are per operation, so no cycle can
--     be closed:
--
--       commit(X)  holds intent X, waits for state
--       renew(X)   waits for intent X, holds nothing          -> no cycle
--       commit(Y)  holds intent Y, waits for state            -> no cycle
--       seal(X)    holds intent X only                        -> no cycle
--       maintenance/rollback/GC hold state only               -> no cycle
--
-- The intent row is held exclusively from before the first check until the
-- transaction ends. That is the proof the task asks for: between "this attempt
-- is the sealed attempt" and "the state row now records this commit" nothing
-- can re-seal, re-base or terminalise the intent.
--
-- Everything else in the lock order is unchanged. acquire/renew/assert/release
-- still take FOR SHARE on the intent first (S5), begin/seal still touch intents
-- only, and maintenance still touches state only.
--
-- ---------------------------------------------------------------------------
-- Decision order (a failing call names its real reason)
-- ---------------------------------------------------------------------------
--
--   1. parameter validation                22004 / 22023
--   2. authorisation                       P0001
--   3. intent row, FOR UPDATE              CDP09 (missing)
--   4. terminal/replay branches            CDI03 / CDP05 / P0001
--   5. in_progress intent                  CDP10
--   6. sealed content: attempt, release    CDI03 / CDP05
--   7. state row, FOR UPDATE               P0001 / 55P03
--   8. maintenance lock                    CDP04
--   9. lease operation + token             CDP03
--  10. lease expiry                        CDP02
--  11. lease attempt witness               CDI03
--  12. stale intent (generation moved)     CDP06 outcome + terminal failed
--  13. caller CAS mismatch                 CDP06 (raised; intent untouched)
--  14. release already published           CDP07
--  15. history INSERT                      CDP05 / CDP06 / CDP07 on named
--                                          constraints, anything else re-raised
--  16. state UPDATE                        CDP06 on row-count drift
--  17. intent -> committed
--  18. audit INSERT
--
-- CDI03 is reused rather than minted: "the presented attempt is not the one
-- that owns this lease/seal" is one condition, whichever RPC observes it.
--
-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------
--
-- The history row keyed on operation_id is the record, as before. Two additions:
--
--   * a committed intent replays without reading the state row at all, so a
--     retry works after the successful commit cleared the lease (and even while
--     a maintenance lock is held). It still verifies the attempt, so a second
--     attempt of the same operation cannot read the first one's result, and it
--     still compares release, generated_at, counts and actor, so a different
--     payload is CDP05. expected_generation and the token are concurrency
--     tokens, not content, and are not compared on replay.
--   * a terminal failed intent replays its recorded outcome (outcome='failed',
--     the stored failure_code, idempotent=true). There is no history row for a
--     failed commit, so the intent row is the record. The replay compares what
--     the intent kept — release_id and expected_generation — and the attempt;
--     generated_at and counts were never stored on a failed intent, which the
--     contract documents rather than pretends to check.
--
-- Idempotency never runs before require_admin_actor: an unauthorised actor
-- cannot replay an operation id to read its result.
--
-- ---------------------------------------------------------------------------
-- The stale-intent outcome (generation advanced by another operation)
-- ---------------------------------------------------------------------------
--
-- If the intent was sealed against a generation the state row has left behind,
-- the operation can never publish and must not be re-based or re-sealed. The
-- commit therefore records a terminal failure in the same transaction instead
-- of raising CDP06:
--
--   * intent -> failed, failure_code = 'CDP06', failure_reason set,
--   * the S3 trigger drops the payload (and the shape CHECK keeps the seal
--     metadata, which is legal for failed),
--   * the publish lease and its attempt are cleared, because the operation is
--     over and holding the global lease would only block the next publisher,
--   * the pointer, metadata and generation do not move,
--   * no history row and no audit row are written, and
--
-- it returns one result row: outcome='failed', failure_code='CDP06',
-- idempotent=false, generation=null, committed_at=null.
--
-- It has to return rather than raise: a RAISE would roll the terminal
-- transition back with it, leaving the stale intent sealed forever. The result
-- row is the only way to both persist the failure and report it. A replay of
-- the failed intent returns the same outcome with idempotent=true.
--
-- The failure path is deliberately not audited. There is no catalog state
-- change to audit, and an audit insert that failed would roll the terminal
-- transition back — the exact contradiction this path exists to avoid. The
-- intent row is the durable record, and it is readable by the operator.
--
-- Only the lease holder may terminalise: the path runs after the token, expiry
-- and attempt checks, so a caller that does not hold the lease gets CDP02/
-- CDP03/CDI03 and the intent stays sealed with its payload.
--
-- ---------------------------------------------------------------------------
-- Atomicity
-- ---------------------------------------------------------------------------
--
-- History INSERT, state UPDATE, intent UPDATE and audit INSERT are one
-- transaction. The audit insert is the last step, so a failure there is the
-- realistic partial-failure case and rolls every earlier write back. Unique
-- violations are mapped only for the three named constraints that can race;
-- an unknown 23505 is re-raised unchanged rather than being mistaken for a
-- contract conflict.
--
-- ---------------------------------------------------------------------------
-- SQLSTATE contract (machine-readable; messages are operator hints only)
-- ---------------------------------------------------------------------------
--
--   CDP02 lease_expired             the token matches but its expiry has passed
--   CDP03 invalid_lease_token       no lease, or operation/token mismatch
--   CDP04 maintenance_busy          an active maintenance lock blocks publication
--   CDP05 operation_id_conflict     same operation id, different content/actor/
--                                   release, or a release the intent did not seal
--   CDP06 generation_conflict       expected_generation is not the live value
--   CDP07 release_conflict          release_id was already published
--   CDP09 intent_not_found          the operation has no intent row
--   CDP10 intent_state_conflict     the intent is in_progress (never sealed)
--   CDI03 lease_attempt_mismatch    the attempt is not the one that sealed the
--                                   intent or not the one holding the lease
--   22004 null_value_not_allowed    a required parameter (including the attempt)
--                                   is null
--   22023 invalid_parameter_value   negative generation/count, bad release id,
--                                   non-finite generated_at, generation overflow
--   55P03 lock_not_available        the intent/state row lock was not granted in 5s
--   P0001                           singleton/intent missing, or caller is not an
--                                   admin, or database invariant violated
--
-- 23505 (not a CDP/CDI code) reaches the caller only for a unique violation on
-- a constraint this function does not know about.
--
-- Out of scope here, by instruction: the producer, Storage, the UI, the
-- consumer, the feature flag, hosted databases and deployment.

drop function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer
);

create function public.commit_catalog_publish(
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

    -- A failed intent stores the seal's release and base generation, not the
    -- generated_at/counts of the commit that was refused. Comparing what it
    -- kept is the honest check; pretending to compare the rest would not be.
    if v_intent.release_id is distinct from p_release_id
      or v_intent.expected_generation is distinct from p_expected_generation then
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

    -- Only status and the cause move. The seal metadata is frozen by S3's
    -- guard and remains on the row as the record of what was refused; the
    -- drop-payload trigger removes the bytes, and S3's require-payload check
    -- only constrains sealed rows.
    update public.catalog_publish_intents as i
    set
      status = 'failed',
      failure_code = 'CDP06',
      failure_reason = 'Nesil başka bir yayın tarafından ilerletildi.'
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

-- Only the service role may commit a publication. Remove the default EXECUTE
-- grant to PUBLIC first, then grant the role explicitly.
revoke all on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer, uuid
) to service_role;
