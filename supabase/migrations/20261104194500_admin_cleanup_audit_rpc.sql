-- H1-b — idempotent cleanup audit under concurrency.
--
-- A cleanup enqueue and its actor-facing audit row are two separate facts. The
-- tombstone (cleanup_enqueue_orphan) is the deletion contract; the audit row is
-- history. Before this function, the TypeScript caller did SELECT-then-INSERT,
-- so two concurrent requests for the same (action, path) could both read
-- "missing" and both insert.
--
-- This function serializes that read-then-write inside one transaction:
--
--   1. refuse anything but READ COMMITTED (a REPEATABLE READ snapshot taken
--      before the lock could still miss the winner's committed row),
--   2. validate the actor before taking any lock, so an unauthenticated caller
--      cannot stall the legitimate writer for a path,
--   3. take one transaction-scoped exclusive advisory lock keyed by
--      (action, path), then read the real (action, metadata.path) pair,
--   4. return the existing row with created = false, or delegate the insert to
--      admin_record_external_action and return created = true.
--
-- Hash collisions: hashtextextended maps different (action, path) pairs to the
-- same bigint only by accident. That can add unnecessary serialization between
-- two unrelated paths, but it cannot create a duplicate: correctness comes from
-- the (action, path) SELECT performed after the lock, not from the key being
-- unique. The bigint advisory space is also distinct from the two-int cleanup
-- seal key (20261101, 1), so the two never collide.
--
-- Existing rows are never updated or deleted (admin_audit_logs_immutable also
-- enforces that). Existing duplicates are tolerated: the oldest row is returned
-- and no second row is added.

create function public.admin_ensure_cleanup_audit(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_path text;
  v_existing_id uuid;
  v_audit_id uuid;
begin
  -- The lock guarantees a fresh statement snapshot only under READ COMMITTED.
  -- PostgREST runs each RPC in its own READ COMMITTED transaction; anything
  -- stricter is a caller bug that would reintroduce the duplicate.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = 'P0001',
      message = 'Temizlik denetimi yalnız READ COMMITTED izolasyonunda çalışır.';
  end if;

  -- Fail closed before touching the lock.
  perform private.require_admin_actor(p_actor_id);

  -- Path-keyed dedupe is only meaningful for the two cleanup actions. Other
  -- allowlisted actions (app.update, user.delete, ...) have no path identity.
  if p_action is null
     or p_action not in ('asset.cleanup_pending', 'upload.cleanup') then
    raise exception using
      errcode = 'P0001',
      message = 'Geçersiz temizlik işlemi.';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'Geçersiz audit metadata.';
  end if;

  v_path := p_metadata->>'path';

  -- admin_record_external_action drops unknown metadata keys, which would turn
  -- an invalid path into a pathless row. Refuse it explicitly so the lock key
  -- and the stored row always describe the same object.
  if v_path is null or v_path !~ (
    '^(operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk'
    || '|apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk'
    || '|apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp))$'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Geçersiz temizlik yolu.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cleanup-audit:' || p_action || E'\x1f' || v_path,
      0
    )
  );

  select a.id
    into v_existing_id
  from public.admin_audit_logs as a
  where a.action = p_action
    and a.metadata->>'path' = v_path
  order by a.created_at, a.id
  limit 1;

  if v_existing_id is not null then
    return query select v_existing_id, false;
    return;
  end if;

  v_audit_id := public.admin_record_external_action(
    p_actor_id, p_action, p_target_type, p_target_id, p_metadata
  );

  return query select v_audit_id, true;
end;
$$;

revoke all on function public.admin_ensure_cleanup_audit(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_ensure_cleanup_audit(uuid, text, text, text, jsonb)
  to service_role;
