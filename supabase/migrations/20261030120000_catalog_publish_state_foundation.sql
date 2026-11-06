-- B2 catalog publish state foundation (A10.32b).
--
-- Single-row authority for the active catalog JSON release. PostgreSQL owns the
-- pointer; Storage only holds immutable release documents. The publish and
-- maintenance locks live on the same row and are mutually exclusive, so a
-- publication and a garbage-collection run can never overlap.
--
-- This stage creates the state and history tables only. The state machine
-- (acquire / renew / commit / release / rollback / maintenance / GC RPCs) and
-- the consumer pointer land in later migrations.

create table public.catalog_publish_state (
  id                          smallint    primary key default 1,
  generation                  bigint      not null default 0,
  current_release_id          text,
  generated_at                timestamptz,
  app_count                   integer,
  category_count              integer,
  publish_lock_token          uuid,
  publish_lock_expires_at     timestamptz,
  publish_operation_id        uuid,
  maintenance_lock_token      uuid,
  maintenance_lock_expires_at timestamptz,
  maintenance_operation_id    uuid,
  legacy_manifest_generation  bigint,
  legacy_manifest_release_id  text,
  legacy_manifest_synced_at   timestamptz,

  -- Exactly one row may exist; the primary key alone would accept id = 2.
  constraint catalog_publish_state_singleton check (id = 1),

  constraint catalog_publish_state_generation_nonneg check (generation >= 0),

  constraint catalog_publish_state_counts_nonneg check (
    (app_count is null or app_count >= 0)
    and (category_count is null or category_count >= 0)
  ),

  -- Release pointer and its metadata are all-or-nothing. A pointer without
  -- counts would let the consumer publish an unverifiable snapshot; counts
  -- without a pointer would describe a release nobody serves.
  constraint catalog_publish_state_release_metadata check (
    num_nulls(current_release_id, generated_at, app_count, category_count) in (0, 4)
  ),

  -- Same contract as the consumer (`RELEASE_ID_PATTERN` in
  -- src/features/catalog/catalog-json.repository.ts). A looser database rule
  -- would poison the pointer with an id every new consumer rejects.
  constraint catalog_publish_state_release_format check (
    current_release_id is null
    or current_release_id ~ '^[A-Za-z0-9_-]{8,64}$'
  ),

  -- A token without an expiry is never valid and would make every
  -- "expires > clock_timestamp()" comparison NULL (silent no-op).
  constraint catalog_publish_state_publish_lock_pair check (
    (publish_lock_token is null) = (publish_lock_expires_at is null)
  ),

  -- An operation id outliving its lock would misattribute the next publisher's
  -- work in audit records.
  constraint catalog_publish_state_publish_operation_pair check (
    publish_lock_token is not null or publish_operation_id is null
  ),

  constraint catalog_publish_state_maintenance_lock_pair check (
    (maintenance_lock_token is null) = (maintenance_lock_expires_at is null)
  ),

  constraint catalog_publish_state_maintenance_operation_pair check (
    maintenance_lock_token is not null or maintenance_operation_id is null
  ),

  -- Publishing and garbage collection must never run at the same time: a GC
  -- that decided "not active" would race a publication that makes it active.
  constraint catalog_publish_state_locks_exclusive check (
    publish_lock_token is null or maintenance_lock_token is null
  ),

  constraint catalog_publish_state_legacy_manifest_metadata check (
    num_nulls(
      legacy_manifest_generation,
      legacy_manifest_release_id,
      legacy_manifest_synced_at
    ) in (0, 3)
  ),

  constraint catalog_publish_state_legacy_manifest_release_format check (
    legacy_manifest_release_id is null
    or legacy_manifest_release_id ~ '^[A-Za-z0-9_-]{8,64}$'
  )
);

-- Seed the singleton without ever overwriting a state written by a later run.
insert into public.catalog_publish_state (id, generation)
values (1, 0)
on conflict (id) do nothing;

create table public.catalog_publish_history (
  id             bigint      generated always as identity primary key,
  operation_id   uuid        not null,
  release_id     text        not null,
  generation     bigint      not null,
  kind           text        not null,
  actor_id       uuid        not null,
  generated_at   timestamptz not null,
  app_count      integer     not null,
  category_count integer     not null,
  committed_at   timestamptz not null default now(),

  -- The idempotency key: a retried commit carries the same operation id and
  -- must not advance the generation twice.
  constraint catalog_publish_history_operation_unique unique (operation_id),

  -- Independent of the state row's CAS: two releases can never share a
  -- generation even if application logic regresses.
  constraint catalog_publish_history_generation_unique unique (generation),

  constraint catalog_publish_history_generation_positive check (generation > 0),

  constraint catalog_publish_history_counts_nonneg check (
    app_count >= 0 and category_count >= 0
  ),

  constraint catalog_publish_history_kind_valid check (
    kind in ('publish', 'rollback')
  ),

  constraint catalog_publish_history_release_format check (
    release_id ~ '^[A-Za-z0-9_-]{8,64}$'
  )
);

-- A release may be published fresh exactly once. Rollbacks reuse the release
-- id on purpose, so the uniqueness only covers kind = 'publish'.
create unique index catalog_publish_history_publish_release_unique
  on public.catalog_publish_history (release_id)
  where kind = 'publish';

alter table public.catalog_publish_state enable row level security;
alter table public.catalog_publish_history enable row level security;

-- The local stack runs with auto_expose_new_tables = false; revoke explicitly
-- anyway so a future config change cannot expose the pointer or the history to
-- the Data API.
revoke all on table public.catalog_publish_state
  from public, anon, authenticated, service_role;
revoke all on table public.catalog_publish_history
  from public, anon, authenticated, service_role;

-- service_role is the only writer. It needs SELECT/UPDATE for the invoker-style
-- state RPCs added in the next migration; INSERT is unnecessary because the
-- singleton is seeded here.
grant select, update on table public.catalog_publish_state to service_role;

-- Append-only: no UPDATE, no DELETE. A bad history row must be corrected by a
-- new row, never by rewriting the past.
grant select, insert on table public.catalog_publish_history to service_role;

-- Audit integration (A10.32b): the catalog state machine records publish,
-- rollback, reconcile and GC events. The existing allowlist is extended, never
-- reordered or renamed, and every previous value is preserved.
alter table public.admin_audit_logs
  drop constraint admin_audit_logs_action_check,
  add constraint admin_audit_logs_action_check check (
    action = any (array[
      'app.create', 'app.update', 'app.archive', 'app.activate', 'app.delete',
      'category.create', 'category.update',
      'asset.upload', 'asset.cleanup_pending',
      'screenshot.create', 'screenshot.update', 'screenshot.delete',
      'version.draft', 'version.publish', 'version.withdraw', 'version.replace',
      'upload.cleanup',
      'review.hide', 'review.show', 'review.delete',
      'report.resolve', 'report.dismiss',
      'user.suspend', 'user.activate', 'user.delete', 'user.recovery_request',
      'catalog.publish', 'catalog.rollback', 'catalog.reconcile', 'catalog.gc'
    ])
  );

-- Keep admin_record_external_action's own allowlist in sync with the constraint
-- above. Only additive changes: the existing actions, their target types and
-- the metadata whitelist are untouched. Catalog audit rows written inside a
-- publish/commit RPC go straight to admin_audit_logs (same transaction); this
-- function stays the path for admin-panel initiated actions.
create or replace function public.admin_record_external_action(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  audit_id uuid;
  safe_metadata jsonb;
  expected_target_type text;
  external_actions constant text[] = array[
    'app.create', 'app.update', 'app.archive', 'app.delete',
    'category.create', 'category.update',
    'asset.upload', 'asset.cleanup_pending',
    'screenshot.create', 'screenshot.update', 'screenshot.delete',
    'version.draft', 'version.replace', 'upload.cleanup',
    'user.delete', 'user.recovery_request',
    'catalog.publish', 'catalog.rollback', 'catalog.reconcile', 'catalog.gc'
  ];
begin
  perform private.require_admin_actor(p_actor_id);

  if not p_action = any (external_actions) then
    raise exception using errcode = 'P0001', message = 'Geçersiz yönetim işlemi.';
  end if;

  expected_target_type = case
    when p_action like 'app.%' then 'app'
    when p_action like 'category.%' then 'category'
    when p_action in ('asset.upload', 'asset.cleanup_pending') then 'asset'
    when p_action like 'screenshot.%' then 'screenshot'
    when p_action in ('version.draft', 'version.replace') then 'version'
    when p_action = 'upload.cleanup' then 'upload'
    when p_action like 'user.%' then 'user'
    when p_action like 'catalog.%' then 'catalog_release'
  end;

  if p_target_type is distinct from expected_target_type then
    raise exception using errcode = 'P0001', message = 'İşlem ve hedef türü eşleşmiyor.';
  end if;

  if p_action in ('app.delete', 'version.replace', 'asset.cleanup_pending')
    and p_target_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception using errcode = 'P0001', message = 'Geçersiz audit hedef kimliği.';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Geçersiz audit metadata.';
  end if;

  if p_action = 'asset.cleanup_pending' and not coalesce((
    jsonb_typeof(p_metadata->'bucket') = 'string'
    and jsonb_typeof(p_metadata->'path') = 'string'
    and jsonb_typeof(p_metadata->'operation_id') = 'string'
    and p_metadata->>'operation_id' = p_target_id
    and (
      (
        p_metadata->>'bucket' = 'apk-drafts'
        and p_metadata->>'path' ~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$'
      )
      or (
        p_metadata->>'bucket' = 'apks'
        and p_metadata->>'path' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
      )
      or (
        p_metadata->>'bucket' = 'app-assets'
        and p_metadata->>'path' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      )
    )
  ), false) then
    raise exception using errcode = 'P0001', message = 'Geçersiz cleanup audit metadata.';
  end if;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into safe_metadata
  from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as entry
  where case
    when entry.key in ('old_status', 'new_status', 'status') then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' = any (array[
        'active', 'archived', 'draft', 'published', 'withdrawn',
        'visible', 'hidden', 'open', 'resolved', 'dismissed', 'suspended'
      ])
    when entry.key in ('version_code', 'old_version_code', 'new_version_code') then
      jsonb_typeof(entry.value) = 'number'
      and entry.value #>> '{}' ~ '^[0-9]+$'
      and (entry.value #>> '{}')::numeric between 1 and 2147483647
    when entry.key = 'bucket' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' = any (array['apk-drafts', 'apks', 'app-assets'])
    when entry.key = 'path' then
      jsonb_typeof(entry.value) = 'string'
      and (
        entry.value #>> '{}' ~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$'
        or entry.value #>> '{}' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
        or entry.value #>> '{}' ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      )
    when entry.key = 'operation_id' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when entry.key = 'partial' then
      jsonb_typeof(entry.value) = 'boolean'
    when entry.key = 'download_source' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' in ('storage', 'external')
    when entry.key = 'hostname' then
      jsonb_typeof(entry.value) = 'string'
      and char_length(entry.value #>> '{}') between 1 and 253
      and (
        entry.value #>> '{}' ~ '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
        or entry.value #>> '{}' ~ '^[0-9A-Fa-f]*:[0-9A-Fa-f:]+$'
      )
    when entry.key in ('supports_mobile', 'supports_tv') then
      jsonb_typeof(entry.value) = 'boolean'
    when entry.key = 'account_requirement' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' in ('none', 'optional', 'required')
    when entry.key = 'release_id' then
      jsonb_typeof(entry.value) = 'string'
      and entry.value #>> '{}' ~ '^[A-Za-z0-9_-]{8,64}$'
    when entry.key = 'generation' then
      jsonb_typeof(entry.value) = 'number'
      and entry.value #>> '{}' ~ '^[0-9]+$'
      and char_length(entry.value #>> '{}') <= 19
      and (entry.value #>> '{}')::bigint >= 0
    else false
  end;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_actor_id, p_action, p_target_type, p_target_id, safe_metadata)
  returning id into audit_id;

  return audit_id;
end;
$$;
