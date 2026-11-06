-- B2 committed publish result reader (A10.36 S7.1).
--
-- A commit is durable before its HTTP response reaches the producer. If that
-- response is lost, the next attempt sees a committed intent and must be able
-- to report the committed outcome instead of retrying a publication that
-- already happened. The existing intent reader is deliberately not widened:
-- it has no attempt or actor gate and exists for status/pre-read only. This is
-- the narrow, committed-only reader S7.1 needs.
--
-- Contract:
--
--   * committed intents only. An in_progress, sealed or failed intent is CDP10
--     and a missing intent is CDP09, so "no result" never looks like "not
--     committed yet".
--   * keyed on the operation id and gated on the attempt that sealed it. The
--     history table has no attempt column, so the attempt is proven through the
--     intent before the history row is read.
--   * the actor must be the admin who committed the operation, and a release
--     supplied by the caller must match. Both are CDP05, the same code commit
--     replay uses for "this operation already belongs to another publish".
--   * every value comes from the append-only history row. generated_at, counts
--     and generation are never accepted from the caller: after a commit the
--     payload is gone, so a caller cannot know them and must not guess.
--   * is_current compares both halves of the pointer (release id AND
--     generation) with history. A later generation makes the result superseded,
--     not invalid; the commit itself is permanent.
--   * history absence or a kind/release inconsistency is a corrupt ledger and
--     fails closed with P0001 instead of returning a partial result.
--
-- SECURITY INVOKER: service_role already holds the SELECT grants these tables
-- need. DEFINER would only widen the privilege surface. No RLS policy or table
-- grant changes are part of this stage.

create function public.get_catalog_publish_result(
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

  if v_intent.status <> 'committed' then
    raise exception using errcode = 'CDP10',
      message = 'Yayın sonucu yalnızca tamamlanmış işlem için okunabilir.';
  end if;

  -- The attempt gate follows the status gate on purpose: an in_progress intent
  -- has no attempt yet (S3 keeps attempt_id null until seal), so checking it
  -- first would turn every "not committed" call into a misleading CDI03.
  if v_intent.attempt_id is distinct from p_attempt_id then
    raise exception using errcode = 'CDI03',
      message = 'Deneme kimliği yayın niyetiyle uyuşmuyor.';
  end if;

  -- 4. History is the authoritative record of the commit. Its absence after a
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

  -- 5. Actor and optional release binding. Both use CDP05 so a replay and a
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

  -- 6. The pointer only decides whether this commit is still current. It never
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

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoke that first, then
-- grant the one role that drives publication.
revoke all on function public.get_catalog_publish_result(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_publish_result(
  uuid, uuid, uuid, text
) to service_role;
