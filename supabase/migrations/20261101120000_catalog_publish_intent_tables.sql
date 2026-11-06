-- B2 catalog publish intent tables (A10.36 S3).
--
-- The publish flow has three durable facts: an operation began, its payload was
-- sealed, and the payload either reached the catalog or failed for good. The
-- lease and commit RPCs already own the catalog pointer; these two tables own
-- the intent, so a retry after a lost response can prove it is carrying the same
-- bytes instead of rebuilding them from a catalog that may have moved on.
--
-- States (terminal in capitals):
--
--   in_progress -> sealed -> COMMITTED
--        \____________\---> FAILED
--
-- `abandoned` is deliberately not modelled: A10.36 never writes it, and a state
-- value nobody sets would only be dead weight in every CHECK below.
--
-- Invariants enforced here rather than in the RPCs:
--
--   * operation_id is the key of both tables, so the relation is strictly
--     one-to-one and a second payload for an operation is impossible.
--   * The payload row carries the digest, and the composite foreign key
--     (operation_id, payload_digest) makes "the digest I declared" and "the
--     digest of the payload I stored" the same value. That key is deferred,
--     because the payload is attached before the intent is sealed; the
--     trigger functions reject a mismatch at the offending statement, and the
--     deferred key is the commit-time backstop.
--   * A payload may only be inserted while the intent is in_progress or
--     sealed. Terminal states never hold bytes.
--   * A sealed payload may not be deleted directly. The only legitimate ways
--     out are the AFTER UPDATE trigger below (status moved to committed or
--     failed) or a cascade delete of the whole intent.
--   * Moving to committed or failed deletes the payload in the same
--     transaction, so "terminal" and "payload present" can never be observed
--     together. This is a trigger because PostgreSQL CHECK constraints cannot
--     read another table; a transaction boundary alone would depend on every
--     caller remembering the rule.
--   * A sealed intent must have a payload. An UPDATE that seals without one is
--     rejected immediately by the transition guard; a direct sealed INSERT is
--     caught by the DEFERRABLE constraint trigger, so a commit can never
--     publish a seal with no bytes behind it.
--   * Sealed content is immutable: release_id, expected_generation, attempt_id,
--     payload_digest and sealed_at are frozen once the seal exists.
--   * created_at is server-owned; updated_at is rewritten by a trigger.
--
-- The payload is `text`, never `jsonb`. jsonb reorders object keys and drops
-- duplicate keys, which would silently change the bytes the digest was computed
-- over. The database therefore validates the digest *format* only; computing
-- it is the producer's job (admin/src/features/catalog/payload-digest.ts) and
-- no pgcrypto dependency is introduced for a check that would run on every
-- write of a multi-megabyte value.
--
-- Size: 5242880 bytes = three catalog documents at the producer's 1.5 MiB
-- per-file limit (3 x 1572864) plus 512 KiB for the JSON envelope that carries
-- them. A future fourth file must revisit this number.

create table public.catalog_publish_intents (
  operation_id        uuid        not null,
  release_id          text        not null,
  status              text        not null default 'in_progress',
  expected_generation bigint      not null,
  payload_digest      text,
  attempt_id          uuid,
  sealed_at           timestamptz,
  failure_code        text,
  failure_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint catalog_publish_intents_pkey primary key (operation_id),

  -- Same contract as catalog_publish_state_release_format and the consumer
  -- (`RELEASE_ID_PATTERN`): a looser rule would let an intent point at a
  -- release id every consumer rejects.
  constraint catalog_publish_intents_release_format check (
    release_id ~ '^[A-Za-z0-9_-]{8,64}$'
  ),

  constraint catalog_publish_intents_status_valid check (
    status in ('in_progress', 'sealed', 'committed', 'failed')
  ),

  constraint catalog_publish_intents_generation_nonneg check (
    expected_generation >= 0
  ),

  -- Lowercase hex only: the producer emits lowercase, and accepting a second
  -- spelling would let two digests describe the same payload.
  constraint catalog_publish_intents_digest_format check (
    payload_digest is null or payload_digest ~ '^[0-9a-f]{64}$'
  ),

  -- One shape per state. in_progress has no seal yet; sealed and committed
  -- carry the seal metadata; failed must name its cause. A failed intent keeps
  -- whatever seal metadata it had, which is why those columns are not forced to
  -- null there.
  constraint catalog_publish_intents_state_shape check (
    case status
      when 'in_progress' then
        payload_digest is null
        and attempt_id is null
        and sealed_at is null
        and failure_code is null
        and failure_reason is null
      when 'sealed' then
        payload_digest is not null
        and attempt_id is not null
        and sealed_at is not null
        and failure_code is null
        and failure_reason is null
      when 'committed' then
        payload_digest is not null
        and attempt_id is not null
        and sealed_at is not null
        and failure_code is null
        and failure_reason is null
      when 'failed' then
        failure_code is not null
        and failure_reason is not null
      else false
    end
  ),

  -- Machine-readable cause. Free text belongs in failure_reason, never here,
  -- so a client can switch on the code without parsing a message.
  constraint catalog_publish_intents_failure_code_format check (
    failure_code is null or failure_code ~ '^[A-Za-z][A-Za-z0-9_]{1,63}$'
  ),

  -- Bound the row: failure_reason is a short operator hint, not a log sink,
  -- and must never grow a payload-like body.
  constraint catalog_publish_intents_failure_reason_length check (
    failure_reason is null
    or char_length(failure_reason) between 1 and 500
  ),

  -- The composite key the payload FK targets, which is what makes the stored
  -- digest and the declared digest the same value.
  constraint catalog_publish_intents_operation_digest_unique unique (
    operation_id, payload_digest
  )
);

comment on table public.catalog_publish_intents is
  'Durable publication intent: one row per operation id, keyed for idempotent retry.';
comment on column public.catalog_publish_intents.status is
  'in_progress -> sealed -> committed, or sealed/in_progress -> failed. Terminal states are committed and failed.';
comment on column public.catalog_publish_intents.payload_digest is
  'Lowercase hex SHA-256 of the canonical JSON payload bytes; the payload row carries the same value.';
comment on column public.catalog_publish_intents.attempt_id is
  'Identifies the sealing attempt that produced the payload; set together with payload_digest and sealed_at.';

-- A retention sweep for never-retried sealed intents will filter by status and
-- age; keep that scan off the heap.
create index catalog_publish_intents_status_created_at_idx
  on public.catalog_publish_intents (status, created_at);

create table public.catalog_publish_intent_payloads (
  operation_id   uuid        not null,
  payload        text        not null,
  payload_digest text        not null,
  created_at     timestamptz not null default now(),

  constraint catalog_publish_intent_payloads_pkey primary key (operation_id),

  constraint catalog_publish_intent_payloads_digest_format check (
    payload_digest ~ '^[0-9a-f]{64}$'
  ),

  -- octet_length, not char_length: the limit is about the bytes the digest was
  -- computed over, and a Turkish character costs two of them.
  constraint catalog_publish_intent_payloads_size check (
    octet_length(payload) between 1 and 5242880
  ),

  -- Composite on purpose. A plain operation_id FK would allow a payload whose
  -- digest disagrees with the intent that declared it; this one cannot.
  --
  -- DEFERRABLE because the two rows are written in the same transaction but
  -- not in the same statement: the payload is attached while the intent is
  -- still in_progress, and the intent only learns the digest when it is
  -- sealed. The checks in the trigger functions below reject a mismatch at the
  -- statement that causes it; this constraint is the commit-time backstop that
  -- no future code path can bypass.
  constraint catalog_publish_intent_payloads_intent_fkey
    foreign key (operation_id, payload_digest)
    references public.catalog_publish_intents (operation_id, payload_digest)
    on delete cascade
    deferrable initially deferred
);

comment on table public.catalog_publish_intent_payloads is
  'Byte-exact sealed payload for a live intent; deleted when the intent reaches committed or failed.';
comment on column public.catalog_publish_intent_payloads.payload is
  'Canonical JSON text exactly as digested by the producer. Text, not jsonb, so no key reordering or deduplication can change the bytes.';

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

-- created_at is server-owned and updated_at is never the caller's to choose.
create function private.catalog_publish_intent_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Reject illegal transitions and freeze sealed content. Runs BEFORE UPDATE so
-- the row is never written in a state the next reader would have to distrust.
create function private.catalog_publish_intent_guard_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload_digest text;
begin
  if new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000',
      message = 'Yayın niyetinin oluşturulma zamanı değiştirilemez.';
  end if;

  -- Sealing is the moment the intent adopts a payload, so the payload must
  -- already exist and carry exactly the digest being declared. Checking here
  -- gives the caller an immediate, precise error; the composite FK is the
  -- deferred backstop.
  if new.payload_digest is not null
    and new.payload_digest is distinct from old.payload_digest then
    select p.payload_digest
    into v_payload_digest
    from public.catalog_publish_intent_payloads as p
    where p.operation_id = new.operation_id;

    if not found then
      raise exception using errcode = '23514',
        message = 'Mühürlenecek yayın yükü bulunamadı.';
    end if;

    if v_payload_digest is distinct from new.payload_digest then
      raise exception using errcode = '23503',
        message = 'Yük özeti niyetin bildirdiği özetle uyuşmuyor.';
    end if;
  end if;

  if old.status in ('sealed', 'committed') then
    if new.release_id is distinct from old.release_id
      or new.expected_generation is distinct from old.expected_generation
      or new.attempt_id is distinct from old.attempt_id
      or new.payload_digest is distinct from old.payload_digest
      or new.sealed_at is distinct from old.sealed_at then
      raise exception using errcode = '55000',
        message = 'Mühürlenmiş yayın niyeti değiştirilemez.';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'in_progress' and new.status in ('sealed', 'failed'))
      or (old.status = 'sealed' and new.status in ('committed', 'failed'))
    ) then
      raise exception using errcode = '55000',
        message = 'Geçersiz yayın niyeti durum geçişi.';
    end if;
  end if;

  return new;
end;
$$;

-- A payload may exist only while the intent is live. The parent row is held
-- FOR SHARE so a concurrent transition to a terminal state cannot slip between
-- this check and the insert: the transition needs FOR UPDATE and waits.
create function private.catalog_publish_intent_guard_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_digest text;
begin
  if tg_op = 'DELETE' then
    select i.status
    into v_status
    from public.catalog_publish_intents as i
    where i.operation_id = old.operation_id;

    -- A cascade delete from the intent runs after the parent row is gone; that
    -- is the only legitimate way to remove a payload from a live intent.
    if v_status is null then
      return old;
    end if;

    if v_status not in ('committed', 'failed') then
      raise exception using errcode = '55000',
        message = 'Mühürlü yayın yükü yalnızca terminal durumda silinebilir.';
    end if;

    return old;
  end if;

  select i.status, i.payload_digest
  into v_status, v_digest
  from public.catalog_publish_intents as i
  where i.operation_id = new.operation_id
  for share;

  if v_status is null then
    raise exception using errcode = '23503',
      message = 'Yayın niyeti bulunamadı.';
  end if;

  if v_status not in ('in_progress', 'sealed') then
    raise exception using errcode = '55000',
      message = 'Terminal durumdaki yayın niyeti yük taşıyamaz.';
  end if;

  -- A sealed intent already declared its digest; a payload that disagrees can
  -- never become the sealed bytes. While the intent is in_progress the digest
  -- is still unknown and the deferred composite FK reconciles the pair at
  -- commit.
  if v_digest is not null and v_digest is distinct from new.payload_digest then
    raise exception using errcode = '23503',
      message = 'Yük özeti niyetin bildirdiği özetle uyuşmuyor.';
  end if;

  return new;
end;
$$;

-- The transition that makes a payload terminal deletes it in the same
-- statement. The payload guard sees the already-written terminal status, so
-- this delete is the one path it permits.
create function private.catalog_publish_intent_drop_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.catalog_publish_intent_payloads as p
  where p.operation_id = new.operation_id;

  return null;
end;
$$;

-- The mirror of the guard above: sealed implies payload. An UPDATE that seals
-- without a payload is rejected earlier by the transition guard; this deferred
-- check exists for a direct sealed INSERT, where the payload row can only be
-- written after the intent. A commit can never publish a seal with no bytes
-- behind it.
create function private.catalog_publish_intent_require_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.catalog_publish_intents as i
    where i.operation_id = new.operation_id
      and i.status = 'sealed'
  ) and not exists (
    select 1
    from public.catalog_publish_intent_payloads as p
    where p.operation_id = new.operation_id
  ) then
    raise exception using errcode = '23514',
      message = 'Mühürlü yayın niyeti yük olmadan var olamaz.';
  end if;

  return null;
end;
$$;

create trigger catalog_publish_intents_touch_updated_at
before update on public.catalog_publish_intents
for each row
execute function private.catalog_publish_intent_touch();

create trigger catalog_publish_intents_guard_transition
before update on public.catalog_publish_intents
for each row
execute function private.catalog_publish_intent_guard_transition();

create trigger catalog_publish_intents_drop_payload
after update on public.catalog_publish_intents
for each row
when (
  new.status in ('committed', 'failed')
  and old.status is distinct from new.status
)
execute function private.catalog_publish_intent_drop_payload();

create trigger catalog_publish_intent_payloads_guard
before insert or update or delete on public.catalog_publish_intent_payloads
for each row
execute function private.catalog_publish_intent_guard_payload();

create constraint trigger catalog_publish_intents_require_payload
after insert or update on public.catalog_publish_intents
deferrable initially deferred
for each row
execute function private.catalog_publish_intent_require_payload();

-- Trigger functions are invoked by the trigger machinery, never by a client.
revoke all on function private.catalog_publish_intent_touch()
  from public, anon, authenticated, service_role;
revoke all on function private.catalog_publish_intent_guard_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.catalog_publish_intent_guard_payload()
  from public, anon, authenticated, service_role;
revoke all on function private.catalog_publish_intent_drop_payload()
  from public, anon, authenticated, service_role;
revoke all on function private.catalog_publish_intent_require_payload()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.catalog_publish_intents enable row level security;
alter table public.catalog_publish_intent_payloads enable row level security;

-- auto_expose_new_tables = false already keeps the Data API out; revoke
-- explicitly so a future config change cannot expose the intent or its payload.
revoke all on table public.catalog_publish_intents
  from public, anon, authenticated, service_role;
revoke all on table public.catalog_publish_intent_payloads
  from public, anon, authenticated, service_role;

-- service_role drives the state machine from the invoker-style RPCs. It cannot
-- DELETE an intent: the ledger is append-only, and interest payloads are
-- removed by the transition trigger, not by losing the intent row.
grant select, insert, update on table public.catalog_publish_intents
  to service_role;

-- No UPDATE: the payload text is byte-exact by definition, and rewriting it
-- under an unchanged digest would silently break the retry guarantee. The
-- delete path exists for the transition trigger and for explicit cleanup.
grant select, insert, delete on table public.catalog_publish_intent_payloads
  to service_role;
