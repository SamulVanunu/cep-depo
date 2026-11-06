-- B2 catalog publish lease ↔ intent attempt integration (A10.36 S5).
--
-- S3 gave an operation a durable intent; S4 let it seal byte-exact payloads
-- under an attempt id. The lease, however, was still keyed on the operation id
-- alone, so a second attempt of the same operation asking for the lease was
-- answered with the first attempt's token. That is the hole this stage closes:
-- the lease now records which attempt holds it, and every later call can prove
-- it is still that attempt and not just that it knows the token.
--
-- What is deliberately *not* here: the commit RPC, the producer, Storage, the
-- UI, the consumer, and any migration of existing rows. The commit RPC gains
-- its own intent and attempt checks in a later stage; this one only makes the
-- two facts it needs available and keeps both of its existing statements valid.
--
-- ---------------------------------------------------------------------------
-- Attempt identity on the state row
-- ---------------------------------------------------------------------------
--
-- `catalog_publish_state.publish_attempt_id` is the attempt that acquired the
-- current publish lease. It is nullable because the legacy call shape (no
-- attempt) must keep working, and it is never accepted without a lease.
--
-- The attempt always dies with the lease, and it has to die for writers this
-- migration does not touch: commit_catalog_publish and the maintenance
-- takeover both clear the three publish columns in one statement, and neither
-- may be edited here. A BEFORE UPDATE trigger therefore drops the attempt in
-- the same statement that drops the token, and the CHECK constraint below is
-- the hard backstop for every other writer. Triggers run before constraints,
-- so the two paths agree by construction rather than by convention.
--
-- ---------------------------------------------------------------------------
-- Lock order (the whole point of the concurrency section)
-- ---------------------------------------------------------------------------
--
-- Every function that touches both tables takes the intent row first and the
-- publish-state row second:
--
--   catalog_publish_intents (FOR SHARE, by operation_id)
--     -> catalog_publish_state (id = 1, FOR UPDATE or FOR SHARE)
--
-- and nothing may ever take them in the other order. Functions that touch one
-- table only cannot close a cycle with these:
--
--   * begin_catalog_publish_intent  — intents only,
--   * seal_catalog_publish_intent   — intents only (its payload guard takes
--                                     FOR SHARE on the same intent row),
--   * commit_catalog_publish        — state only,
--   * maintenance acquire/renew/assert/release — state only.
--
-- The intent is locked FOR SHARE, never FOR UPDATE: these functions do not
-- write it, they only need it to hold still while they validate. That keeps a
-- concurrent seal (which takes FOR UPDATE) from flipping `status` or
-- `attempt_id` between the check and the lease write, and it keeps the lock
-- order with a single upgrade path in one direction.
--
-- A future stage that makes commit_catalog_publish read the intent must read
-- and lock it *before* it locks the state row. Adding that read after the
-- FOR UPDATE would be the first inversion in this file's order and could
-- deadlock two publishers against each other.
--
-- Owning the state row while waiting: every wait is bounded by the per-call
-- lock_timeout = 5s that the existing RPCs already set, mapped to 55P03. The
-- intent lock is taken first, so a caller that waits for the global row holds
-- only its own operation's intent, not the other way round.
--
-- ---------------------------------------------------------------------------
-- SQLSTATE contract (machine-readable; messages are operator hints only)
-- ---------------------------------------------------------------------------
--
--   CDI01 lease_attempt_conflict    the operation's live lease belongs to a
--                                   different attempt (including a lease that
--                                   was taken without any attempt identity)
--   CDI02 intent_generation_mismatch the in_progress intent was built against
--                                   a generation the state row has left behind
--   CDI03 lease_attempt_mismatch    renew/assert/release presented an attempt
--                                   that is not the one holding the lease, or
--                                   not the one the sealed intent names
--   CDP09 intent_not_found          reused: renew/assert/release/acquire with
--                                   an attempt for an operation with no intent
--   CDP10 intent_state_conflict     reused: the intent is no longer in the
--                                   state that permits the requested step
--
-- CDI01..CDI03 continue the family: class "C", subclass starting with "I" —
-- the range PostgreSQL reserves for implementations, the same rule CDP01..CDP10
-- already follow. No existing code changes meaning, and no new code collides
-- with CDP01..CDP10, the superseded CD0xx family, or a standard SQLSTATE.
--
-- Reusing CDP09/CDP10 instead of minting new codes is deliberate: the code
-- names the condition, not the function that reports it. "There is no such
-- intent" is the same fact whichever RPC observes it.
--
-- ---------------------------------------------------------------------------
-- Compatibility boundary, stated once
-- ---------------------------------------------------------------------------
--
-- A call that omits p_attempt_id behaves exactly as it did before: no intent
-- is read, no intent is required, and an active lease of the same operation
-- returns its stored token. The attempt gate is opt-in per call.
--
-- Two consequences follow, and both are the intended fail-closed answers rather
-- than accidents:
--
--   * a lease taken without an attempt cannot be adopted by one (CDI01), and
--   * a legacy call for an operation whose lease records an attempt still
--     recovers the token, because the caller is the same operation and the
--     operation is the capability it always was.
--
-- Mixing the two shapes within one run is therefore not a supported pattern:
-- a run either presents its attempt on every lease call or on none.

-- ---------------------------------------------------------------------------
-- State row: attempt column, pairing constraint, end-of-lease trigger
-- ---------------------------------------------------------------------------

alter table public.catalog_publish_state
  add column publish_attempt_id uuid;

comment on column public.catalog_publish_state.publish_attempt_id is
  'Attempt that holds the current publish lease; null for a lease taken without an attempt identity.';

-- An attempt without a lease would describe a holder that cannot act.
alter table public.catalog_publish_state
  add constraint catalog_publish_state_publish_attempt_pair check (
    publish_lock_token is not null or publish_attempt_id is null
  );

-- Runs before the CHECK above, on the one statement shape every lease-ending
-- writer already uses. Deliberately narrow: only a transition from a token to
-- no token normalises the column, so a direct write that invents an attempt on
-- a lease-less row is still rejected by the constraint instead of being
-- silently rewritten.
create function private.catalog_publish_state_clear_attempt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.publish_lock_token is not null
    and new.publish_lock_token is null then
    new.publish_attempt_id := null;
  end if;

  return new;
end;
$$;

create trigger catalog_publish_state_clear_attempt_on_lease_end
before update on public.catalog_publish_state
for each row
execute function private.catalog_publish_state_clear_attempt();

revoke all on function private.catalog_publish_state_clear_attempt()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- acquire_catalog_publish_lease
-- ---------------------------------------------------------------------------
--
-- Legacy: identical to the previous body when p_attempt_id is null.
--
-- With an attempt: the operation must have an in_progress intent (S3 forbids
-- attempt_id there, so the attempt is adopted by the lease now and reconciled
-- with the intent when that attempt seals), and the intent's
-- expected_generation must still be the state's generation. Acquiring a lease
-- for an intent that would certainly fail its commit-time compare-and-set is
-- refused early (CDI02) instead of wasting the whole publish.
--
-- release_id is not checked here: it is not an acquire parameter and the state
-- row has no counterpart for it. The intent freezes it at seal and the commit
-- RPC proves it is still unpublished (CDP07). An attempt-bearing acquire can
-- therefore only be as consistent as the two facts it can see.
--
-- Idempotency, in the order the codes are decided:
--
--   another operation holds the live lease        -> CDP01 (unchanged)
--   this operation, another attempt               -> CDI01
--   this operation, the same attempt              -> stored token, idempotent
--   this operation, legacy call, no attempt given -> stored token, idempotent
--   an expired lease of any operation             -> taken over, fresh token
--
-- The expired-takeover path is unchanged in shape and still explicit: a fresh
-- token is issued in the same UPDATE that clears the stale maintenance lock, so
-- the previous holder's token, and now its attempt, stop matching immediately.
--
-- The default on p_attempt_id is what keeps old callers compiling, but a
-- defaulted parameter makes CREATE OR REPLACE create an overload rather than a
-- replacement. The signature is dropped first so a two-argument call cannot
-- resolve to a stale body that skips every check above the state row.
drop function public.acquire_catalog_publish_lease(uuid, integer);

create function public.acquire_catalog_publish_lease(
  p_operation_id uuid,
  p_lease_seconds integer,
  p_attempt_id uuid default null
)
returns table (
  lease_token uuid,
  lease_expires_at timestamptz,
  state_generation bigint,
  idempotent boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_intent public.catalog_publish_intents%rowtype;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_token uuid;
begin
  if p_operation_id is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği zorunlu.';
  end if;

  if p_lease_seconds is null then
    raise exception using errcode = '22004',
      message = 'Kilit süresi zorunlu.';
  end if;

  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode = '22023',
      message = 'Kilit süresi 30 ile 900 saniye arasında olmalı.';
  end if;

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- 1. Intent gate. First in the lock order, and skipped entirely by a legacy
  -- call so its behaviour and its lock footprint are unchanged.
  if p_attempt_id is not null then
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

    -- Only in_progress. A sealed intent already carries the attempt that
    -- produced its bytes; handing it a lease would let a second attempt drive
    -- that seal. A terminal intent is over.
    if v_intent.status <> 'in_progress' then
      raise exception using errcode = 'CDP10',
        message = 'Yayın niyeti kilit alınabilecek durumda değil.';
    end if;
  end if;

  -- 2. Publish-state row, second in the lock order.
  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
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

  -- Read only after the row lock is granted: a caller that waited 30 seconds
  -- must not evaluate the lease against the timestamp from before the wait.
  v_now := pg_catalog.clock_timestamp();

  -- 3. The intent must still describe the world the lease would serve.
  if p_attempt_id is not null then
    if v_intent.expected_generation is distinct from v_state.generation then
      raise exception using errcode = 'CDI02',
        message = 'Yayın niyeti güncel nesille uyuşmuyor.';
    end if;
  end if;

  -- 4. An active maintenance lock still blocks publication, before the lease
  -- checks, exactly as it did before this stage.
  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    raise exception using errcode = 'CDP04',
      message = 'Bakım kilidi etkin, yayın kilidi alınamaz.';
  end if;

  -- 5. A live lease decides by owner first, then by attempt.
  if v_state.publish_lock_token is not null
    and v_state.publish_lock_expires_at > v_now then
    if v_state.publish_operation_id is distinct from p_operation_id then
      raise exception using errcode = 'CDP01',
        message = 'Yayın kilidi başka bir işlem tarafından tutuluyor.';
    end if;

    if p_attempt_id is not null then
      if v_state.publish_attempt_id is distinct from p_attempt_id then
        raise exception using errcode = 'CDI01',
          message = 'Yayın kilidi bu işlemin başka bir denemesine ait.';
      end if;
    end if;

    return query
      select
        v_state.publish_lock_token,
        v_state.publish_lock_expires_at,
        v_state.generation,
        true;
    return;
  end if;

  -- 6. Fresh lease, or takeover of an expired one.
  v_token := pg_catalog.gen_random_uuid();
  v_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  -- Catalogue metadata columns are deliberately absent. The expired
  -- maintenance lock is cleared in the same statement because
  -- catalog_publish_state_locks_exclusive is asset-based, not time-based: a
  -- stale maintenance token would otherwise block every future publication.
  update public.catalog_publish_state
  set
    publish_lock_token = v_token,
    publish_lock_expires_at = v_expires_at,
    publish_operation_id = p_operation_id,
    publish_attempt_id = p_attempt_id,
    maintenance_lock_token = null,
    maintenance_lock_expires_at = null,
    maintenance_operation_id = null
  where id = 1
  returning * into v_state;

  return query
    select v_token, v_expires_at, v_state.generation, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- renew_catalog_publish_lease
-- ---------------------------------------------------------------------------
--
-- The token/operation pair is still checked before the expiry on purpose: after
-- a takeover the previous owner gets CDP03 (its token is no longer the lease),
-- while an owner whose lease merely ran out gets CDP02.
--
-- With an attempt there are two witnesses, and both must agree:
--
--   * the intent, when it is sealed, names the attempt that produced its bytes;
--   * the state row names the attempt that holds the lease.
--
-- The intent is read first (lock order) and is the cheaper rejection: a call
-- that presents an attempt the seal already contradicts is refused without
-- touching the global row. When the intent is still in_progress its attempt_id
-- is null by S3's shape constraint, so there is nothing to contradict and the
-- lease row decides.
drop function public.renew_catalog_publish_lease(uuid, uuid, integer);

create function public.renew_catalog_publish_lease(
  p_operation_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer,
  p_attempt_id uuid default null
)
returns table (
  lease_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_intent public.catalog_publish_intents%rowtype;
  v_now timestamptz;
  v_expires_at timestamptz;
begin
  if p_operation_id is null or p_lease_token is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği ve kilit anahtarı zorunlu.';
  end if;

  if p_lease_seconds is null then
    raise exception using errcode = '22004',
      message = 'Kilit süresi zorunlu.';
  end if;

  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode = '22023',
      message = 'Kilit süresi 30 ile 900 saniye arasında olmalı.';
  end if;

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  if p_attempt_id is not null then
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

    if v_intent.attempt_id is not null then
      if v_intent.attempt_id is distinct from p_attempt_id then
        raise exception using errcode = 'CDI03',
          message = 'Deneme kimliği mühürlenmiş yayın niyetiyle uyuşmuyor.';
      end if;
    end if;
  end if;

  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
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

  if v_state.publish_lock_token is null
    or v_state.publish_operation_id is distinct from p_operation_id
    or v_state.publish_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Yayın kilidi bu işleme ait değil.';
  end if;

  if v_state.publish_lock_expires_at <= v_now then
    raise exception using errcode = 'CDP02',
      message = 'Yayın kilidinin süresi dolmuş.';
  end if;

  if p_attempt_id is not null then
    if v_state.publish_attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Yayın kilidi bu deneme kimliğine ait değil.';
    end if;
  end if;

  v_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  -- The maintenance columns are untouched: the locks_exclusive constraint
  -- guarantees they are null whenever a publish token is present.
  update public.catalog_publish_state
  set publish_lock_expires_at = v_expires_at
  where id = 1;

  return query select v_expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- assert_catalog_publish_lease
-- ---------------------------------------------------------------------------
--
-- Returns true and changes nothing. Failure is always an exception, so a caller
-- cannot mistake "no row" for success. FOR SHARE (not FOR UPDATE) is used so a
-- commit transaction can hold the row against a takeover for its own duration
-- while other readers keep working; the share lock is released at the end of
-- that transaction. The commit path must still guard its UPDATE with the same
-- operation id, token and expiry, because assert only proves the state at the
-- instant it runs.
--
-- The attempt check is the reason the token alone is no longer enough: a token
-- recovered from a log, a retry queue or a stale closure proves possession, not
-- authorship. With an attempt the caller must also be the attempt that holds
-- the lease and, once sealed, the attempt the intent names.
drop function public.assert_catalog_publish_lease(uuid, uuid);

create function public.assert_catalog_publish_lease(
  p_operation_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_intent public.catalog_publish_intents%rowtype;
  v_now timestamptz;
begin
  if p_operation_id is null or p_lease_token is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği ve kilit anahtarı zorunlu.';
  end if;

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  if p_attempt_id is not null then
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

    if v_intent.attempt_id is not null then
      if v_intent.attempt_id is distinct from p_attempt_id then
        raise exception using errcode = 'CDI03',
          message = 'Deneme kimliği mühürlenmiş yayın niyetiyle uyuşmuyor.';
      end if;
    end if;
  end if;

  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
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

  if v_state.publish_lock_token is null
    or v_state.publish_operation_id is distinct from p_operation_id
    or v_state.publish_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Yayın kilidi bu işleme ait değil.';
  end if;

  if v_state.publish_lock_expires_at <= v_now then
    raise exception using errcode = 'CDP02',
      message = 'Yayın kilidinin süresi dolmuş.';
  end if;

  if p_attempt_id is not null then
    if v_state.publish_attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Yayın kilidi bu deneme kimliğine ait değil.';
    end if;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- release_catalog_publish_lease
-- ---------------------------------------------------------------------------
--
-- Idempotent: with no lease held the call returns false and does nothing. A
-- mismatch is a rejection and never touches the live lease. Expiry is not
-- checked, so the owner can still clean up after its own lease ran out.
--
-- The attempt check runs after the token check, which is what makes "the old
-- attempt cannot release the new attempt's lease" true twice over: the old
-- attempt's token no longer matches (CDP03), and if it somehow did, the attempt
-- would not (CDI03). The attempt is cleared in the same UPDATE as the token,
-- and the state-row trigger does it again for writers outside this file.
drop function public.release_catalog_publish_lease(uuid, uuid);

create function public.release_catalog_publish_lease(
  p_operation_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_intent public.catalog_publish_intents%rowtype;
begin
  if p_operation_id is null or p_lease_token is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği ve kilit anahtarı zorunlu.';
  end if;

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  if p_attempt_id is not null then
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

    if v_intent.attempt_id is not null then
      if v_intent.attempt_id is distinct from p_attempt_id then
        raise exception using errcode = 'CDI03',
          message = 'Deneme kimliği mühürlenmiş yayın niyetiyle uyuşmuyor.';
      end if;
    end if;
  end if;

  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
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

  if v_state.publish_lock_token is null then
    return false;
  end if;

  if v_state.publish_operation_id is distinct from p_operation_id
    or v_state.publish_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Yayın kilidi bu işleme ait değil.';
  end if;

  if p_attempt_id is not null then
    if v_state.publish_attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Yayın kilidi bu deneme kimliğine ait değil.';
    end if;
  end if;

  -- One statement for all four columns: the pair and operation constraints are
  -- checked per row, never per assignment.
  update public.catalog_publish_state
  set
    publish_lock_token = null,
    publish_lock_expires_at = null,
    publish_operation_id = null,
    publish_attempt_id = null
  where id = 1;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- The signature drop took the old ACL with it, so the grants are re-stated
-- rather than relied on. CREATE FUNCTION grants EXECUTE to PUBLIC by default:
-- revoke that first, then grant the one role that drives publication. The table
-- grants are untouched; these functions run as the caller and need exactly what
-- service_role already has.

revoke all on function public.acquire_catalog_publish_lease(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_catalog_publish_lease(uuid, integer, uuid)
  to service_role;

revoke all on function public.renew_catalog_publish_lease(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.renew_catalog_publish_lease(uuid, uuid, integer, uuid)
  to service_role;

revoke all on function public.assert_catalog_publish_lease(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_catalog_publish_lease(uuid, uuid, uuid)
  to service_role;

revoke all on function public.release_catalog_publish_lease(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_catalog_publish_lease(uuid, uuid, uuid)
  to service_role;
