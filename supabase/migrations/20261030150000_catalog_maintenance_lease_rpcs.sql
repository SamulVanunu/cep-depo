-- B2 catalog maintenance lease RPCs (A10.35).
--
-- The state foundation already reserves maintenance_lock_token,
-- maintenance_lock_expires_at and maintenance_operation_id on
-- catalog_publish_state, and catalog_publish_state_locks_exclusive forbids a
-- publish and a maintenance token in the same row. The publish acquire RPC
-- already rejects a live maintenance lock (CDP04) and clears an expired one.
-- This migration adds the four RPCs for the other side of the pair, with the
-- same contract as the publish lease:
--
--   * the caller supplies an operation id and a duration of 30..900 seconds,
--   * a live lease owned by the same operation id is returned unchanged with
--     idempotent = true (the lease is not extended, so a lost response can be
--     recovered by repeating the call),
--   * an expired lease of any operation is taken over with a fresh token,
--   * renew and assert check the operation id AND token before the expiry, so
--     a stale owner gets CDP03 while the live owner whose lease merely ran out
--     gets CDP02,
--   * release is idempotent when no lease is held and never touches another
--     owner's lease,
--   * clock_timestamp() is read only after the row lock is granted,
--   * no error message, DETAIL or HINT may carry the lease token.
--
-- SQLSTATE codes reuse the publish lease family so one client-side map covers
-- both leases:
--
--   CDP01 lease_busy            another operation holds a live maintenance lease
--   CDP02 lease_expired         the lease expired before renew/assert
--   CDP03 lease_not_owner       operation id or token does not match the lease
--   CDP04 publish_busy          a live publish lease blocks the maintenance lease
--   22023 invalid_parameter     duration outside 30..900
--   22004 null_parameter        missing operation id, token or duration
--   55P03 lock_not_available    the state row lock was not granted in time
--   P0001                       the singleton state row is missing

-- Acquire the maintenance lease.
--
-- A live publish lease wins over the same operation id on purpose: publishing
-- and maintenance must never overlap, so the two families are not
-- interchangeable and one operation cannot hold both at once.
create or replace function public.acquire_catalog_maintenance_lease(
  p_operation_id uuid,
  p_lease_seconds integer
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

  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
    for update;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Katalog bakım kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  -- Read only after the row lock is granted: a caller that waited 30 seconds
  -- must not evaluate the lease against the timestamp from before the wait.
  v_now := pg_catalog.clock_timestamp();

  -- A live publish lease always blocks maintenance, even for the same
  -- operation id. The invalidate-and-retry owner must finish or expire first.
  if v_state.publish_lock_token is not null
    and v_state.publish_lock_expires_at > v_now then
    raise exception using errcode = 'CDP04',
      message = 'Yayın kilidi etkin, bakım kilidi alınamaz.';
  end if;

  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    if v_state.maintenance_operation_id = p_operation_id then
      return query
        select
          v_state.maintenance_lock_token,
          v_state.maintenance_lock_expires_at,
          v_state.generation,
          true;
      return;
    end if;

    raise exception using errcode = 'CDP01',
      message = 'Bakım kilidi başka bir işlem tarafından tutuluyor.';
  end if;

  v_token := pg_catalog.gen_random_uuid();
  v_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  -- Catalog metadata columns are deliberately absent from this UPDATE. An
  -- expired publish lock is cleared in the same statement because
  -- catalog_publish_state_locks_exclusive is asset-based, not time-based: a
  -- stale publish token would otherwise block every future maintenance run.
  update public.catalog_publish_state
  set
    maintenance_lock_token = v_token,
    maintenance_lock_expires_at = v_expires_at,
    maintenance_operation_id = p_operation_id,
    publish_lock_token = null,
    publish_lock_expires_at = null,
    publish_operation_id = null
  where id = 1
  returning * into v_state;

  return query
    select v_token, v_expires_at, v_state.generation, false;
end;
$$;

-- Extend the maintenance lease of its current owner.
--
-- The token/operation pair is checked before the expiry on purpose: after a
-- takeover the previous owner gets CDP03 (its token is no longer the lease),
-- while an owner whose lease merely ran out gets CDP02.
create or replace function public.renew_catalog_maintenance_lease(
  p_operation_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
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

  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
    for update;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Katalog bakım kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  v_now := pg_catalog.clock_timestamp();

  if v_state.maintenance_lock_token is null
    or v_state.maintenance_operation_id is distinct from p_operation_id
    or v_state.maintenance_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Bakım kilidi bu işleme ait değil.';
  end if;

  if v_state.maintenance_lock_expires_at <= v_now then
    raise exception using errcode = 'CDP02',
      message = 'Bakım kilidinin süresi dolmuş.';
  end if;

  v_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  -- The publish columns are untouched: the locks_exclusive constraint
  -- guarantees they are null whenever a maintenance token is present.
  update public.catalog_publish_state
  set maintenance_lock_expires_at = v_expires_at
  where id = 1;

  return query select v_expires_at;
end;
$$;

-- Assert that the caller still owns a live maintenance lease.
--
-- Returns true and changes nothing. Failure is always an exception, so a caller
-- cannot mistake "no row" for success. FOR SHARE (not FOR UPDATE) is used so a
-- reconcile/GC transaction can hold the row against a publish acquire for its
-- own duration while other readers keep working; the share lock is released at
-- the end of that transaction. The maintenance work must still re-check the
-- operation id, token and expiry before any write, because assert only proves
-- the state at the instant it runs.
create or replace function public.assert_catalog_maintenance_lease(
  p_operation_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_now timestamptz;
begin
  if p_operation_id is null or p_lease_token is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği ve kilit anahtarı zorunlu.';
  end if;

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
    for share;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Katalog bakım kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  v_now := pg_catalog.clock_timestamp();

  if v_state.maintenance_lock_token is null
    or v_state.maintenance_operation_id is distinct from p_operation_id
    or v_state.maintenance_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Bakım kilidi bu işleme ait değil.';
  end if;

  if v_state.maintenance_lock_expires_at <= v_now then
    raise exception using errcode = 'CDP02',
      message = 'Bakım kilidinin süresi dolmuş.';
  end if;

  return true;
end;
$$;

-- Release the maintenance lease owned by the caller.
--
-- Idempotent: with no maintenance lease held the call returns false and does
-- nothing. A mismatch is CDP03 and never touches the live lease. Expiry is not
-- checked, so the owner can still clean up after its own lease ran out.
create or replace function public.release_catalog_maintenance_lease(
  p_operation_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
begin
  if p_operation_id is null or p_lease_token is null then
    raise exception using errcode = '22004',
      message = 'İşlem kimliği ve kilit anahtarı zorunlu.';
  end if;

  perform pg_catalog.set_config('lock_timeout', '5s', true);

  begin
    select *
    into v_state
    from public.catalog_publish_state
    where id = 1
    for update;
  exception
    when lock_not_available then
      raise exception using errcode = '55P03',
        message = 'Katalog bakım kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  if v_state.maintenance_lock_token is null then
    return false;
  end if;

  if v_state.maintenance_operation_id is distinct from p_operation_id
    or v_state.maintenance_lock_token is distinct from p_lease_token then
    raise exception using errcode = 'CDP03',
      message = 'Bakım kilidi bu işleme ait değil.';
  end if;

  -- One statement for all three columns: the pair and operation constraints are
  -- checked per row, never per assignment.
  update public.catalog_publish_state
  set
    maintenance_lock_token = null,
    maintenance_lock_expires_at = null,
    maintenance_operation_id = null
  where id = 1;

  return true;
end;
$$;

-- service_role is the only writer, exactly like the publish lease. The explicit
-- revoke also survives a hand-applied file: CREATE OR REPLACE keeps the old ACL,
-- so the intent is restated here instead of assumed.
revoke all on function public.acquire_catalog_maintenance_lease(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_catalog_maintenance_lease(uuid, integer)
  to service_role;

revoke all on function public.renew_catalog_maintenance_lease(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.renew_catalog_maintenance_lease(uuid, uuid, integer)
  to service_role;

revoke all on function public.assert_catalog_maintenance_lease(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_catalog_maintenance_lease(uuid, uuid)
  to service_role;

revoke all on function public.release_catalog_maintenance_lease(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_catalog_maintenance_lease(uuid, uuid)
  to service_role;
