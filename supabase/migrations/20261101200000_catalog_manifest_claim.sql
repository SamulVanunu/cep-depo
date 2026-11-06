-- B2 catalog manifest claim fence (A10.36 S8).
--
-- The commit makes a release durable, and the root `manifest.json` is the
-- pointer clients read to find it. Until this stage the producer wrote that
-- mutable object after the commit with no proof that its generation was still
-- the live one: a slow publisher could restore an older manifest after a newer
-- commit had already moved the pointer.
--
-- The manifest carries no generation field, so the decision has to come from
-- the database. This stage adds a claim — independent of the publish lease —
-- that is taken only after a commit and re-proven immediately before the
-- upload:
--
--   committed intent -> sealed attempt -> publish history row -> live pointer
--
-- ---------------------------------------------------------------------------
-- Why a separate claim, not the publish lease
-- ---------------------------------------------------------------------------
--
-- The commit clears the publish lease in its own transaction: the release is
-- durable, so holding the global publish lock any longer would only block the
-- next publisher. The manifest is written after that, and it needs a fence
-- that (a) can be acquired after the lease is gone, (b) is scoped to one
-- committed generation, and (c) can be asserted again right before the object
-- PUT. Folding this into the publish lease would mean keeping the global lock
-- across a Storage call, which the lease contract deliberately does not do.
--
-- ---------------------------------------------------------------------------
-- Lock order (unchanged)
-- ---------------------------------------------------------------------------
--
--   catalog_publish_intents (FOR SHARE, by operation_id)
--     -> catalog_publish_state (id = 1, FOR UPDATE for claim/release,
--                               FOR SHARE for assert)
--
-- Claim, assert and release never take the state row before the intent row.
-- They only read the intent, so FOR SHARE matches the lease RPCs and keeps the
-- single upgrade path (seal takes the intent FOR UPDATE) in one direction.
--
-- Claim/release take the state row FOR UPDATE because they write the claim
-- columns; assert takes FOR SHARE because it only reads them, and the share
-- lock still prevents a takeover from committing between the check and the end
-- of the statement. All waits are bounded by lock_timeout = 5s -> 55P03.
--
-- ---------------------------------------------------------------------------
-- Claim semantics
-- ---------------------------------------------------------------------------
--
-- Allowed only when every one of these holds:
--
--   1. the intent exists (CDP09), names the presenting attempt (CDI03) and is
--      committed (CDP10);
--   2. the history row exists, is kind = 'publish', and matches the intent
--      release (P0001 otherwise);
--   3. the caller is the history actor and names the history release (CDP05);
--   4. the state generation equals the history generation AND the current
--      release equals the history release (CDP06). This is the old-publisher
--      fence: once another commit (or rollback) moves the pointer, this
--      operation can never claim or re-assert;
--   5. no live maintenance lock (CDP04);
--   6. no live publish lease of another operation/attempt (CDP01). An expired
--      lease never blocks a claim, because it protects nothing;
--   7. the claim row is free, expired, generation-stale, or already this exact
--      operation/attempt (idempotent: the same live token is returned).
--
-- A live claim of another operation at the history generation is CDI04. A
-- claim row whose generation is newer than the history is a corrupt ledger
-- (P0001) rather than a state to take over.
--
-- ---------------------------------------------------------------------------
-- Assert / release
-- ---------------------------------------------------------------------------
--
-- Assert re-reads the same four facts and then checks the claim token, its
-- attempt, its expiry and the claim generation. Any of these can change
-- between claim and upload, which is exactly why the producer calls assert
-- immediately before the PUT. `CDP06` is the "a newer commit owns the
-- manifest now" answer; `CDP02`/`CDP03` mean the claim was lost or expired.
--
-- Release is idempotent (`false` when nothing is held), never checks expiry
-- (the owner may still clean up after its own claim ran out), and clears all
-- five columns in one statement so the completeness constraint is evaluated
-- per row, not per assignment.
--
-- ---------------------------------------------------------------------------
-- SQLSTATE contract (machine-readable; messages are operator hints only)
-- ---------------------------------------------------------------------------
--
--   CDP01 lease_busy              another operation holds a live publish lease
--   CDP02 lease_expired           the manifest claim has expired
--   CDP03 invalid_lease_token     the claim token is absent or not this one
--   CDP04 maintenance_busy        a live maintenance lock blocks the claim
--   CDP05 operation_id_conflict   actor/release differs from the history
--   CDP06 generation_conflict     the pointer has moved past this commit
--   CDP09 intent_not_found        no intent for the operation id
--   CDP10 intent_state_conflict   the intent is not committed
--   CDI03 lease_attempt_mismatch  the attempt is not the sealed/claiming one
--   CDI04 manifest_claim_conflict another operation holds a live claim
--   22004 null_value_not_allowed  a required parameter is null
--   22023 invalid_parameter_value claim seconds/release id out of contract
--   55P03 lock_not_available      the intent/state row lock was not granted in 5s
--   P0001                         missing state/history or corrupt ledger
--
-- SECURITY INVOKER, service_role only. No RLS policy or table grant changes:
-- service_role already holds SELECT/UPDATE on the state row and SELECT/INSERT
-- on the append-only history.

-- ---------------------------------------------------------------------------
-- State row: claim columns and their shape
-- ---------------------------------------------------------------------------

alter table public.catalog_publish_state
  add column manifest_claim_token      uuid,
  add column manifest_claim_expires_at timestamptz,
  add column manifest_operation_id     uuid,
  add column manifest_attempt_id       uuid,
  add column manifest_generation       bigint;

comment on column public.catalog_publish_state.manifest_claim_token is
  'Token that currently owns the root manifest.json write; null when no claim is held.';
comment on column public.catalog_publish_state.manifest_claim_expires_at is
  'Expiry of the manifest claim; a claim past this instant can be taken over.';
comment on column public.catalog_publish_state.manifest_operation_id is
  'Committed operation that owns the manifest claim.';
comment on column public.catalog_publish_state.manifest_attempt_id is
  'Sealing attempt that owns the manifest claim.';
comment on column public.catalog_publish_state.manifest_generation is
  'Committed generation the claim is allowed to write; never above state.generation.';

-- A token without the rest of the claim would describe a holder that cannot
-- be proven, and a generation without a token would outlive its owner.
alter table public.catalog_publish_state
  add constraint catalog_publish_state_manifest_claim_complete check (
    num_nulls(
      manifest_claim_token,
      manifest_claim_expires_at,
      manifest_operation_id,
      manifest_attempt_id,
      manifest_generation
    ) in (0, 5)
  ),
  add constraint catalog_publish_state_manifest_generation_bound check (
    manifest_generation is null
    or (manifest_generation >= 0 and manifest_generation <= generation)
  );

-- ---------------------------------------------------------------------------
-- claim_catalog_manifest
-- ---------------------------------------------------------------------------

create function public.claim_catalog_manifest(
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

  -- 1. Intent gate. First in the lock order, and only data: the attempt is the
  -- proof that this caller owns the operation, not just its id.
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

  if v_intent.release_id is distinct from p_release_id then
    raise exception using errcode = 'CDP05',
      message = 'İşlem kimliği farklı bir yayınla zaten kullanılmış.';
  end if;

  -- 2. The append-only history row is the authoritative commit record.
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

  -- 4. The old-publisher fence. Both halves of the pointer must still name
  -- this commit: a newer generation OR a different current release means this
  -- operation is superseded and may never restore its manifest.
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

-- ---------------------------------------------------------------------------
-- assert_catalog_manifest_claim
-- ---------------------------------------------------------------------------

create function public.assert_catalog_manifest_claim(
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

-- ---------------------------------------------------------------------------
-- release_catalog_manifest_claim
-- ---------------------------------------------------------------------------

create function public.release_catalog_manifest_claim(
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

-- Only the service role may drive the manifest fence. CREATE FUNCTION grants
-- EXECUTE to PUBLIC by default, so revoke that first and grant explicitly.
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
