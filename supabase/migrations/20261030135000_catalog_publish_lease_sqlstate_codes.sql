-- B2 catalog publish lease SQLSTATE correction (A10.34b).
--
-- 20261030130000 introduced the four lease RPCs with the CD0xx family. That
-- family is not a safe extension point: its class begins with "C", which ISO
-- SQL reserves for the standard, and its subclass begins with "0", which is
-- reserved inside a standard class as well. PostgreSQL documents the rule in
-- src/backend/utils/errcodes.txt: a new code must live in a class starting
-- with 5-9 or I-Z, or use a subclass starting with 5-9 or I-Z (the convention
-- PostgreSQL itself follows with codes such as 22P02 and 55P03).
--
-- CDP01..CDP04 keeps the mnemonic and moves the subclass into "P", the range
-- reserved for implementations. Behaviour is unchanged: only the SQLSTATE
-- literals differ. The applied migration 20261030130000 is left untouched as
-- history; this migration replaces the function bodies in place.

-- Acquire the publication lease.
--
-- Idempotency: when the same operation already holds an *active* lease, the
-- stored token and expiry are returned unchanged and idempotent = true. The
-- lease is not extended, so a lost response can be recovered by repeating the
-- call with the same operation id. An expired lease (of any operation) is taken
-- over with a fresh token. The catalog metadata columns are never written.
--
--   CDP01 lease_busy            another operation holds an active publish lease
--   CDP04 maintenance_busy      an active maintenance lock blocks publication
create or replace function public.acquire_catalog_publish_lease(
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
        message = 'Katalog yayın kilidi zamanında alınamadı.';
  end;

  if v_state.id is null then
    raise exception using errcode = 'P0001',
      message = 'Katalog yayın durumu bulunamadı.';
  end if;

  -- Read only after the row lock is granted: a caller that waited 30 seconds
  -- must not evaluate the lease against the timestamp from before the wait.
  v_now := pg_catalog.clock_timestamp();

  if v_state.maintenance_lock_token is not null
    and v_state.maintenance_lock_expires_at > v_now then
    raise exception using errcode = 'CDP04',
      message = 'Bakım kilidi etkin, yayın kilidi alınamaz.';
  end if;

  if v_state.publish_lock_token is not null
    and v_state.publish_lock_expires_at > v_now then
    if v_state.publish_operation_id = p_operation_id then
      return query
        select
          v_state.publish_lock_token,
          v_state.publish_lock_expires_at,
          v_state.generation,
          true;
      return;
    end if;

    raise exception using errcode = 'CDP01',
      message = 'Yayın kilidi başka bir işlem tarafından tutuluyor.';
  end if;

  v_token := pg_catalog.gen_random_uuid();
  v_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  -- catalogue metadata columns are deliberately absent from this UPDATE. The
  -- expired maintenance lock is cleared in the same statement because
  -- catalog_publish_state_locks_exclusive is asset-based, not time-based: a
  -- stale maintenance token would otherwise block every future publication.
  update public.catalog_publish_state
  set
    publish_lock_token = v_token,
    publish_lock_expires_at = v_expires_at,
    publish_operation_id = p_operation_id,
    maintenance_lock_token = null,
    maintenance_lock_expires_at = null,
    maintenance_operation_id = null
  where id = 1
  returning * into v_state;

  return query
    select v_token, v_expires_at, v_state.generation, false;
end;
$$;

-- Extend the lease of its current owner.
--
-- The token/operation pair is checked before the expiry on purpose: after a
-- takeover the previous owner gets CDP03 (its token is no longer the lease),
-- while an owner whose lease merely ran out gets CDP02.
create or replace function public.renew_catalog_publish_lease(
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

  v_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  -- The maintenance columns are untouched: the locks_exclusive constraint
  -- guarantees they are null whenever a publish token is present.
  update public.catalog_publish_state
  set publish_lock_expires_at = v_expires_at
  where id = 1;

  return query select v_expires_at;
end;
$$;

-- Assert that the caller still owns a live lease.
--
-- Returns true and changes nothing. Failure is always an exception, so a caller
-- cannot mistake "no row" for success. FOR SHARE (not FOR UPDATE) is used so a
-- commit transaction can hold the row against a takeover for its own duration
-- while other readers keep working; the share lock is released at the end of
-- that transaction. The commit path must still guard its UPDATE with the same
-- operation id, token and expiry, because assert only proves the state at the
-- instant it runs.
create or replace function public.assert_catalog_publish_lease(
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

  return true;
end;
$$;

-- Release the lease owned by the caller.
--
-- Idempotent: with no lease held the call returns false and does nothing. A
-- mismatch is CDP03 and never touches the live lease. Expiry is not checked,
-- so the owner can still clean up after its own lease ran out.
create or replace function public.release_catalog_publish_lease(
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

  -- One statement for all three columns: the pair and operation constraints are
  -- checked per row, never per assignment.
  update public.catalog_publish_state
  set
    publish_lock_token = null,
    publish_lock_expires_at = null,
    publish_operation_id = null
  where id = 1;

  return true;
end;
$$;

-- Re-state the grants explicitly. CREATE OR REPLACE keeps the existing ACL,
-- but the intent is part of the contract and must survive a hand-applied file.
revoke all on function public.acquire_catalog_publish_lease(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_catalog_publish_lease(uuid, integer)
  to service_role;

revoke all on function public.renew_catalog_publish_lease(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.renew_catalog_publish_lease(uuid, uuid, integer)
  to service_role;

revoke all on function public.assert_catalog_publish_lease(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_catalog_publish_lease(uuid, uuid)
  to service_role;

revoke all on function public.release_catalog_publish_lease(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_catalog_publish_lease(uuid, uuid)
  to service_role;
