-- B2 catalog publish intent RPCs (A10.36 S4).
--
-- Three invoker RPCs drive the S3 tables. They exist so a producer that loses
-- an HTTP response can prove, on retry, that it is carrying the same bytes as
-- the first attempt instead of rebuilding a payload from a catalog that may
-- have moved on.
--
-- Conventions shared by all three:
--
--   * SECURITY INVOKER with search_path = ''. The only caller is service_role,
--     which already holds BYPASSRLS and the S3 table grants; a definer function
--     would add privilege without adding safety.
--   * Every table and built-in is schema-qualified, so the empty search_path
--     cannot resolve a name to something a caller planted.
--   * No token, payload byte or payload digest appears in an error message. The
--     digest is not a secret, but echoing caller input into an error string is
--     the habit that eventually leaks something that is.
--   * EXECUTE is granted to service_role only.
--   * The payload is stored as the exact text the caller sent. Nothing here
--     parses, normalises or re-serialises JSON; the digest only describes the
--     bytes that were already hashed in admin/src/features/catalog/
--     payload-digest.ts.
--
-- SQLSTATE contract (machine-readable; messages are operator hints only):
--
--   CDP08 intent_conflict         same operation id, different begin parameters,
--                                 or a seal whose attempt/digest/text does not
--                                 match what was already stored
--   CDP09 intent_not_found        no intent row for the operation id
--   CDP10 intent_state_conflict   the intent is committed or failed (terminal),
--                                 so it can no longer be sealed
--   22004 null_value_not_allowed  a required parameter is null
--   22023 invalid_parameter_value bad release id, negative generation, bad
--                                 digest format, empty/oversized payload
--   55P03 lock_not_available      the intent row lock was not granted in 5s
--   42501 insufficient_privilege  anon/authenticated call
--
-- CDP08..CDP10 extend the CDP family introduced by the lease and commit RPCs.
-- The subclass still starts with "P" (the range reserved for implementations),
-- and no existing code is reused with a different meaning. CDP05 remains the
-- commit-time operation-id conflict; the intent lifecycle needs to distinguish
-- "retry with the same bytes" (success) from "already sealed something else"
-- (CDP08) and "this operation is over" (CDP10) without a commit in between.
--
-- Not in this stage: any lease or commit change, producer wiring, Storage, and
-- any RPC that returns payload bytes. get_catalog_publish_intent is metadata
-- only on purpose; a payload reader, when one is actually needed, gets its own
-- narrow function gated on operation id and attempt id.

-- ---------------------------------------------------------------------------
-- begin_catalog_publish_intent
-- ---------------------------------------------------------------------------
--
-- Creates an in_progress intent, or returns the existing one when the same
-- operation id arrives with the same release id and expected generation.
--
-- Idempotency is keyed on operation_id alone, because that is the primary key.
-- A different release id or generation under the same operation id is a
-- conflict (CDP08), never a silent reuse: silently adopting new parameters
-- would let a retry publish a release the caller never sealed.
--
-- begin deliberately reads and writes only catalog_publish_intents. It makes no
-- assumption about other live intents, about catalog_publish_state, or about
-- the publish lease: those are the commit stage's concern, and a begin that
-- peeked at them would couple this table to a lock it does not hold.
create function public.begin_catalog_publish_intent(
  p_operation_id uuid,
  p_release_id text,
  p_expected_generation bigint
)
returns table (
  operation_id uuid,
  release_id text,
  status text,
  expected_generation bigint,
  payload_digest text,
  attempt_id uuid,
  sealed_at timestamptz,
  created_at timestamptz,
  idempotent boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_intent public.catalog_publish_intents%rowtype;
begin
  -- 1. Parameter validation before any row read or write. Same release pattern
  -- as the consumer (RELEASE_ID_PATTERN) and the S3 CHECK, so a malformed call
  -- is rejected with the RPC's own code instead of a raw constraint error.
  if p_operation_id is null
    or p_release_id is null
    or p_expected_generation is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği, yayın kimliği ve beklenen nesil zorunlu.';
  end if;

  if p_release_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception using errcode = '22023',
      message = 'Yayın kimliği geçersiz.';
  end if;

  if p_expected_generation < 0 then
    raise exception using errcode = '22023',
      message = 'Beklenen nesil negatif olamaz.';
  end if;

  -- Per-call lock timeout, like the lease and commit RPCs. begin never takes a
  -- row lock, but a concurrent begin for the same key makes this INSERT wait on
  -- the other transaction; the timeout bounds that wait instead of letting it
  -- run for the life of the caller's transaction.
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- 2. Fast path: the operation is already known. This is not the race-safe
  -- path; the unique-violation handler below covers a concurrent begin.
  select *
  into v_intent
  from public.catalog_publish_intents as i
  where i.operation_id = p_operation_id;

  if found then
    if v_intent.release_id is distinct from p_release_id
      or v_intent.expected_generation is distinct from p_expected_generation then
      raise exception using errcode = 'CDP08',
        message = 'İşlem kimliği farklı bir yayın niyetiyle kullanılmış.';
    end if;

    operation_id := v_intent.operation_id;
    release_id := v_intent.release_id;
    status := v_intent.status;
    expected_generation := v_intent.expected_generation;
    payload_digest := v_intent.payload_digest;
    attempt_id := v_intent.attempt_id;
    sealed_at := v_intent.sealed_at;
    created_at := v_intent.created_at;
    idempotent := true;
    return next;
    return;
  end if;

  -- 3. Fresh intent. A concurrent begin with the same key blocks here until the
  -- winner commits or rolls back:
  --   * winner rolled back  -> this INSERT succeeds,
  --   * winner committed    -> unique_violation, re-read and return its row.
  begin
    insert into public.catalog_publish_intents as i (
      operation_id,
      release_id,
      expected_generation
    )
    values (
      p_operation_id,
      p_release_id,
      p_expected_generation
    )
    returning * into v_intent;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Yayın niyeti kilidi zamanında alınamadı.';
    when unique_violation then
      select *
      into v_intent
      from public.catalog_publish_intents as i
      where i.operation_id = p_operation_id;

      if not found then
        -- Only reachable if the winning insert vanished between its conflict
        -- and this read; surface it instead of returning a phantom success.
        raise exception using errcode = 'P0001',
          message = 'Yayın niyeti oluşturulamadı.';
      end if;

      if v_intent.release_id is distinct from p_release_id
        or v_intent.expected_generation is distinct from p_expected_generation then
        raise exception using errcode = 'CDP08',
          message = 'İşlem kimliği farklı bir yayın niyetiyle kullanılmış.';
      end if;

      operation_id := v_intent.operation_id;
      release_id := v_intent.release_id;
      status := v_intent.status;
      expected_generation := v_intent.expected_generation;
      payload_digest := v_intent.payload_digest;
      attempt_id := v_intent.attempt_id;
      sealed_at := v_intent.sealed_at;
      created_at := v_intent.created_at;
      idempotent := true;
      return next;
      return;
  end;

  operation_id := v_intent.operation_id;
  release_id := v_intent.release_id;
  status := v_intent.status;
  expected_generation := v_intent.expected_generation;
  payload_digest := v_intent.payload_digest;
  attempt_id := v_intent.attempt_id;
  sealed_at := v_intent.sealed_at;
  created_at := v_intent.created_at;
  idempotent := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- seal_catalog_publish_intent
-- ---------------------------------------------------------------------------
--
-- Attaches the payload and moves an in_progress intent to sealed in one
-- transaction. Order matters: the S3 transition guard requires the payload row
-- to exist with the declared digest before the UPDATE to sealed is allowed, so
-- the INSERT runs first and the UPDATE runs second.
--
-- Idempotency: when the intent is already sealed and the attempt id, digest and
-- payload text all match, the call returns the stored seal and writes nothing.
-- Any difference is CDP08. A committed or failed intent is CDP10 regardless of
-- the arguments: the operation is over.
--
-- The 5 MiB limit is measured with octet_length, not char_length, because the
-- digest covers UTF-8 bytes; it is the same bound as the S3 payload CHECK, so a
-- caller sees 22023 from the RPC rather than 23514 from the table.
--
-- Deliberately absent: any SHA-256 computation. The database has no pgcrypto
-- dependency and must not re-hash a multi-megabyte value; the digest equality
-- the database can prove is that the payload row and the intent row agree
-- (composite FK), and that a retry carries the same bytes (text equality).
create function public.seal_catalog_publish_intent(
  p_operation_id uuid,
  p_attempt_id uuid,
  p_payload text,
  p_payload_digest text
)
returns table (
  operation_id uuid,
  status text,
  payload_digest text,
  attempt_id uuid,
  sealed_at timestamptz,
  idempotent boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_intent public.catalog_publish_intents%rowtype;
  v_payload public.catalog_publish_intent_payloads%rowtype;
begin
  -- 1. Parameter validation, before the lock. A malformed call never queues on
  -- the row.
  if p_operation_id is null
    or p_attempt_id is null
    or p_payload is null
    or p_payload_digest is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği, deneme kimliği, yük ve özet zorunlu.';
  end if;

  if p_payload_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023',
      message = 'Yük özeti 64 küçük harf hex karakter olmalı.';
  end if;

  if pg_catalog.octet_length(p_payload) < 1
    or pg_catalog.octet_length(p_payload) > 5242880 then
    raise exception using errcode = '22023',
      message = 'Yük boyutu 1 ile 5242880 bayt arasında olmalı.';
  end if;

  -- 2. Per-call lock timeout; the caller's session setting is untouched.
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- 3. Lock the intent. Concurrent seals of the same operation serialize here,
  -- and the loser re-reads the winner's committed row when the lock is granted.
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

  -- 4. Replay. Same attempt, same digest AND the same bytes is a successful
  -- retry. Comparing the text is what makes "the payload is byte-identical"
  -- true rather than assumed: two different payloads can share a digest only
  -- through a bug or a collision, and neither may be silently accepted.
  if v_intent.status = 'sealed' then
    select *
    into v_payload
    from public.catalog_publish_intent_payloads as p
    where p.operation_id = p_operation_id;

    if v_intent.attempt_id = p_attempt_id
      and v_intent.payload_digest = p_payload_digest
      and v_payload.operation_id is not null
      and v_payload.payload = p_payload then
      operation_id := v_intent.operation_id;
      status := v_intent.status;
      payload_digest := v_intent.payload_digest;
      attempt_id := v_intent.attempt_id;
      sealed_at := v_intent.sealed_at;
      idempotent := true;
      return next;
      return;
    end if;

    raise exception using errcode = 'CDP08',
      message = 'Bu işlem kimliği farklı bir yük ile mühürlenmiş.';
  end if;

  -- 5. Terminal states are final. Checked after the replay branch so a retry of
  -- a successful seal is never mistaken for a state conflict.
  if v_intent.status <> 'in_progress' then
    raise exception using errcode = 'CDP10',
      message = 'Yayın niyeti mühürlenebilir durumda değil.';
  end if;

  -- 6. Attach the payload first. A payload row can only already exist when a
  -- direct service_role write put it there; reuse it only if it is the same
  -- bytes, otherwise refuse rather than overwrite.
  --
  -- No FOR UPDATE here on purpose: S3 grants service_role SELECT/INSERT/DELETE
  -- on the payload table and withholds UPDATE, and a row lock would require it.
  -- The intent row is already locked FOR UPDATE, and the S3 payload guard takes
  -- FOR SHARE on that same intent row, so no concurrent payload write for this
  -- operation can interleave anyway.
  select *
  into v_payload
  from public.catalog_publish_intent_payloads as p
  where p.operation_id = p_operation_id;

  if found then
    if v_payload.payload_digest is distinct from p_payload_digest
      or v_payload.payload is distinct from p_payload then
      raise exception using errcode = 'CDP08',
        message = 'Bu işlem için farklı bir yük zaten kayıtlı.';
    end if;
  else
    insert into public.catalog_publish_intent_payloads as p (
      operation_id,
      payload,
      payload_digest
    )
    values (
      p_operation_id,
      p_payload,
      p_payload_digest
    );
  end if;

  -- 7. Seal. The predicate is redundant under FOR UPDATE; it is the second line
  -- of defence if a future change drops the lock.
  update public.catalog_publish_intents as i
  set status = 'sealed',
      payload_digest = p_payload_digest,
      attempt_id = p_attempt_id,
      sealed_at = pg_catalog.clock_timestamp()
  where i.operation_id = p_operation_id
    and i.status = 'in_progress'
  returning * into v_intent;

  if not found then
    raise exception using errcode = 'CDP10',
      message = 'Yayın niyeti mühürlenebilir durumda değil.';
  end if;

  operation_id := v_intent.operation_id;
  status := v_intent.status;
  payload_digest := v_intent.payload_digest;
  attempt_id := v_intent.attempt_id;
  sealed_at := v_intent.sealed_at;
  idempotent := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_catalog_publish_intent
-- ---------------------------------------------------------------------------
--
-- Metadata only. The payload is intentionally not a column here: a read that
-- returns multi-megabyte content would be the easiest way to fill a log, a
-- cache, or an error message. When a consumer genuinely needs the bytes, it
-- gets a separate function with its own grant, argument set and tests.
--
-- A missing operation returns zero rows, not an exception: "no such intent" is
-- a legitimate answer to a lookup, and the caller can tell absence from a
-- broken call because a broken call raises.
create function public.get_catalog_publish_intent(
  p_operation_id uuid
)
returns table (
  operation_id uuid,
  release_id text,
  status text,
  expected_generation bigint,
  payload_digest text,
  attempt_id uuid,
  sealed_at timestamptz,
  failure_code text,
  failure_reason text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_operation_id is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği zorunlu.';
  end if;

  return query
    select
      i.operation_id,
      i.release_id,
      i.status,
      i.expected_generation,
      i.payload_digest,
      i.attempt_id,
      i.sealed_at,
      i.failure_code,
      i.failure_reason,
      i.created_at,
      i.updated_at
    from public.catalog_publish_intents as i
    where i.operation_id = p_operation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoke that first, then
-- grant the one role that drives publication. The S3 table grants are not
-- widened here; these functions run as the caller and need exactly what
-- service_role already has.

revoke all on function public.begin_catalog_publish_intent(
  uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.begin_catalog_publish_intent(
  uuid, text, bigint
) to service_role;

revoke all on function public.seal_catalog_publish_intent(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.seal_catalog_publish_intent(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.get_catalog_publish_intent(
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_publish_intent(
  uuid
) to service_role;
