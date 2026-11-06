-- B2 catalog publish commit RPC (A10.34b).
--
-- One atomic transaction promotes an uploaded release to the active catalog
-- pointer. Storage keeps the immutable release documents; this row is the only
-- authority. The commit is the single place where generation, pointer,
-- metadata, history and audit move together.
--
-- Conventions:
--
--   * VOLATILE. Every validity check reads clock_timestamp(), never now():
--     now() is frozen at transaction start, so a caller that waited on the row
--     lock would otherwise evaluate the lease against a stale timestamp.
--   * SECURITY INVOKER with search_path = ''. The only caller is service_role,
--     which already holds BYPASSRLS and the table grants; a definer function
--     would add privilege without adding safety.
--   * The singleton row is locked with FOR UPDATE and the timestamp is read
--     only after the lock is granted. PostgREST runs each RPC in its own
--     transaction, so lock_timeout and the write set end with the call.
--   * Parameter validation runs before any authorisation or row read, so a
--     malformed call never takes the lock. require_admin_actor runs before the
--     idempotency lookup so an unauthorised actor cannot replay somebody
--     else's operation id to read its stored result.
--   * Idempotency is keyed on catalog_publish_history.operation_id. A retry
--     with the same content and actor returns the stored result and writes
--     nothing, even though the successful commit already cleared the lease.
--     expected_generation, generation, lease_token and committed_at are NOT
--     part of the payload: the first three are concurrency/lock tokens rather
--     than content, and committed_at is server-assigned.
--   * History INSERT, then state UPDATE, then audit INSERT. Audit is the only
--     step that can fail after the state write, which is what makes the
--     rollback test meaningful: a failure there must revert all three.
--   * Tokens appear only in the function arguments. No error message, DETAIL,
--     HINT, audit row or history row ever contains one.
--
-- SQLSTATE contract (machine-readable, never message text):
--   CDP01 lease_busy              another operation holds an active lease
--   CDP02 lease_expired           the token matches but its expiry has passed
--   CDP03 invalid_lease_token     no lease, or operation/token mismatch
--   CDP04 maintenance_busy        an active maintenance lock blocks publication
--   CDP05 operation_id_conflict   same operation id, different payload/actor
--   CDP06 generation_conflict     expected_generation is not the live value
--   CDP07 release_conflict        release_id was already published
--   22004 null_value_not_allowed  a required parameter is null
--   22023 invalid_parameter_value negative generation/count, bad release id,
--                                 non-finite generated_at, generation overflow
--   55P03 lock_not_available      the state row lock was not granted in 5s
--   P0001                         singleton missing, or caller is not an admin
create function public.commit_catalog_publish(
  p_operation_id uuid,
  p_lease_token uuid,
  p_actor_id uuid,
  p_expected_generation bigint,
  p_release_id text,
  p_generated_at timestamptz,
  p_app_count integer,
  p_category_count integer
)
returns table (
  release_id text,
  generation bigint,
  committed_at timestamptz,
  idempotent boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_history public.catalog_publish_history%rowtype;
  v_now timestamptz;
  v_generation bigint;
  v_committed_at timestamptz;
  v_rows bigint;
  v_constraint text;
begin
  -- 1. Parameter validation. Nothing below runs for a malformed call.
  if p_operation_id is null
    or p_lease_token is null
    or p_actor_id is null
    or p_expected_generation is null
    or p_release_id is null
    or p_generated_at is null
    or p_app_count is null
    or p_category_count is null then
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

  -- 2. Authorisation before any row read, including the idempotency lookup.
  perform private.require_admin_actor(p_actor_id);

  -- 3. Per-call lock timeout; the caller's session setting is untouched.
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- 4. Lock the singleton. Every commit serialises on this row.
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

  -- 5. Read the clock only after the lock is granted.
  v_now := pg_catalog.clock_timestamp();

  -- 6. Idempotency. A successful commit removes the lease, so this must run
  -- before every lease check; otherwise a safe retry would fail with CDP03.
  select *
  into v_history
  from public.catalog_publish_history as h
  where h.operation_id = p_operation_id;

  if found then
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
    return next;
    return;
  end if;

  -- 7. A live maintenance lock blocks publication. This runs before the lease
  -- checks so a publisher whose lease was taken over by maintenance reports
  -- "maintenance" (CDP04) instead of a misleading "invalid token" (CDP03).
  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    raise exception using errcode = 'CDP04',
      message = 'Bakım kilidi etkin, yayın tamamlanamaz.';
  end if;

  -- 8. Lease ownership: operation id and token must both be the live pair.
  if v_state.publish_lock_token is null
    or v_state.publish_operation_id is distinct from p_operation_id
    or v_state.publish_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Yayın kilidi bu işleme ait değil.';
  end if;

  -- 9. Expiry, measured with the timestamp taken under the lock.
  if v_state.publish_lock_expires_at <= v_now then
    raise exception using errcode = 'CDP02',
      message = 'Yayın kilidinin süresi dolmuş.';
  end if;

  -- 10. Compare-and-set on the generation the caller leased.
  if v_state.generation <> p_expected_generation then
    raise exception using errcode = 'CDP06',
      message = 'Beklenen nesil güncel değil.';
  end if;

  -- 11. A release may be published fresh exactly once. The row lock makes this
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

  -- 12. History first: it is the idempotency record and the generation ledger.
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
      -- partial unique index rather than a table constraint.
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

  -- 13. Promote the pointer and metadata, and clear the lease in the same
  -- statement: locks_exclusive then lets maintenance take the row immediately.
  -- The generation predicate is redundant under FOR UPDATE; it is kept as a
  -- second line of defence against a future change that drops the lock.
  update public.catalog_publish_state as s
  set
    generation = v_generation,
    current_release_id = p_release_id,
    generated_at = p_generated_at,
    app_count = p_app_count,
    category_count = p_category_count,
    publish_lock_token = null,
    publish_lock_expires_at = null,
    publish_operation_id = null
  where s.id = 1
    and s.generation = p_expected_generation;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception using errcode = 'CDP06',
      message = 'Beklenen nesil güncel değil.';
  end if;

  -- 14. Audit in the same transaction. A failure here aborts the commit and
  -- rolls back history and state together.
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

  -- 15. Fresh result.
  release_id := p_release_id;
  generation := v_generation;
  committed_at := v_committed_at;
  idempotent := false;
  return next;
end;
$$;

-- Only the service role may commit a publication. Remove the default EXECUTE
-- grant to PUBLIC first, then grant the role explicitly.
revoke all on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer
) from public, anon, authenticated, service_role;

grant execute on function public.commit_catalog_publish(
  uuid, uuid, uuid, bigint, text, timestamptz, integer, integer
) to service_role;
