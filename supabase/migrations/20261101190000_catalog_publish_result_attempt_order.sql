-- B2 committed publish result reader: attempt gate before status (A10.36 S7.1
-- review follow-up).
--
-- 20261101180000 read the intent status before it proved the caller's attempt.
-- An in_progress intent has no sealed attempt (S3 keeps attempt_id null until
-- seal), so that order was chosen to avoid answering every "not committed yet"
-- call with CDI03. The cost was a disclosure: any caller holding an operation
-- id could learn whether that operation is in progress, sealed, failed or
-- committed from the SQLSTATE alone, without ever presenting the attempt.
--
-- This migration restores the approved order:
--
--   1. parameter validation
--   2. require_admin_actor
--   3. intent existence
--   4. attempt match            <- before any status is reported
--   5. committed check
--   6. history and actor/release consistency
--   7. is_current from the state pointer
--
-- The attempt witness depends on the intent's shape, but the answer to a
-- mismatch is always CDI03 and is always decided before the status:
--
--   * sealed / committed / sealed-then-failed: the intent carries the attempt
--     that produced its bytes, exactly as before.
--   * in_progress / failed before seal: attempt_id is null, so the live lease
--     is the only witness. It names both the operation and the attempt that
--     acquired it, and only that pair may learn "not committed yet". No lease,
--     a lease of another operation, or a lease of another attempt is CDI03.
--
-- Lease expiry is deliberately not part of this gate. Expiry decides whether
-- an attempt may still commit (CDP02 in the commit RPC); it does not change
-- which attempt owns the operation. Binding to the stored pair keeps the
-- answer deterministic under the stable snapshot this function reads.
--
-- Everything the committed path returns still comes from the append-only
-- history row, and the pointer still only decides is_current. SECURITY
-- INVOKER and the service_role-only grant are unchanged.

create or replace function public.get_catalog_publish_result(
  p_operation_id uuid,
  p_attempt_id   uuid,
  p_actor_id     uuid,
  p_release_id   text default null
)
returns table (
  operation_id       uuid,
  release_id         text,
  generation         bigint,
  committed_at       timestamptz,
  generated_at       timestamptz,
  app_count          integer,
  category_count     integer,
  actor_id           uuid,
  is_current         boolean,
  current_generation bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_intent  public.catalog_publish_intents%rowtype;
  v_history public.catalog_publish_history%rowtype;
  v_state   public.catalog_publish_state%rowtype;
begin
  -- 1. Parameter validation before any row read.
  if p_operation_id is null or p_attempt_id is null or p_actor_id is null then
    raise exception using errcode = '22004',
      message = 'İşlem, deneme ve aktör kimliği zorunlu.';
  end if;

  if p_release_id is not null
    and p_release_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception using errcode = '22023',
      message = 'Yayın kimliği geçersiz.';
  end if;

  -- 2. Authorisation before the intent read, matching every other publish RPC.
  perform private.require_admin_actor(p_actor_id);

  -- 3. Intent gate. The attempt is the only proof that this caller owns the
  -- operation; the history row itself cannot carry one.
  select *
  into v_intent
  from public.catalog_publish_intents as i
  where i.operation_id = p_operation_id;

  if not found then
    raise exception using errcode = 'CDP09',
      message = 'Yayın niyeti bulunamadı.';
  end if;

  -- 4. Attempt match, before the status is reported. A caller that cannot
  -- prove the attempt must not be able to tell "still running" from "sealed",
  -- "failed" or "committed".
  if v_intent.attempt_id is not null then
    if v_intent.attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Deneme kimliği yayın niyetiyle uyuşmuyor.';
    end if;
  else
    -- No sealed attempt yet. A failed-before-seal intent keeps null too, so
    -- this branch is decided by the lease rather than by the status.
    select *
    into v_state
    from public.catalog_publish_state as s
    where s.id = 1;

    if not found then
      raise exception using errcode = 'P0001',
        message = 'Katalog yayın durumu bulunamadı.';
    end if;

    if v_state.publish_lock_token is null
      or v_state.publish_operation_id is distinct from p_operation_id
      or v_state.publish_attempt_id is distinct from p_attempt_id then
      raise exception using errcode = 'CDI03',
        message = 'Deneme kimliği yayın niyetiyle uyuşmuyor.';
    end if;
  end if;

  -- 5. Only now may the status be reported.
  if v_intent.status <> 'committed' then
    raise exception using errcode = 'CDP10',
      message = 'Yayın sonucu yalnızca tamamlanmış işlem için okunabilir.';
  end if;

  -- 6. History is the authoritative record of the commit. Its absence after a
  -- committed intent is an invariant failure, not an empty result.
  select *
  into v_history
  from public.catalog_publish_history as h
  where h.operation_id = p_operation_id;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'Yayın geçmişi bulunamadı.';
  end if;

  if v_history.kind <> 'publish'
    or v_history.release_id is distinct from v_intent.release_id then
    raise exception using errcode = 'P0001',
      message = 'Yayın geçmişi niyetle tutarsız.';
  end if;

  -- 7. Actor and optional release binding. Both use CDP05 so a replay and a
  -- recovery surface the same "operation already used" contract.
  if v_history.actor_id is distinct from p_actor_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayıncı tarafından kullanılmış.';
  end if;

  if p_release_id is not null
    and v_history.release_id is distinct from p_release_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayınla kullanılmış.';
  end if;

  -- 8. The pointer only decides whether this commit is still current. It never
  -- supplies result values.
  select *
  into v_state
  from public.catalog_publish_state as s
  where s.id = 1;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  return query
    select
      v_history.operation_id,
      v_history.release_id,
      v_history.generation,
      v_history.committed_at,
      v_history.generated_at,
      v_history.app_count,
      v_history.category_count,
      v_history.actor_id,
      (
        v_state.current_release_id is not distinct from v_history.release_id
        and v_state.generation = v_history.generation
      ),
      v_state.generation;
end;
$$;

-- CREATE OR REPLACE keeps the existing grants, but re-stating them keeps the
-- service_role-only boundary visible in this file too.
revoke all on function public.get_catalog_publish_result(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_publish_result(
  uuid, uuid, uuid, text
) to service_role;
