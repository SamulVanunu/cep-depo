-- P8 — cleanup queue schema for the `catalog` bucket.
--
-- Extending the queue to a second managed bucket must not weaken any existing
-- invariant. The queue stays the only tombstone authority, and one row still
-- carries exactly one identity:
--
--   * an asset job carries `operation_id`, a catalog job carries
--     `catalog_release_id` — never both and never neither;
--   * the bucket, target type, path and release id must agree;
--   * only the two immutable release documents are addressable — never a
--     prefix and never an arbitrary object in the bucket;
--   * the pending unique index and the retired-path index keep working, so a
--     catalog tombstone closes its path exactly like an asset one;
--   * `private.cleanup_capture_storage_version()` is bucket-agnostic, so the
--     new bucket inherits the same pinned fingerprint;
--   * the queue stays unreachable for every role except the RPC surface.
--
-- Release-level state is deliberately not added: `catalog_release_id` on the
-- job rows is the only source for release status, so there is no second state
-- machine to keep in sync.

-- ---------------------------------------------------------------------------
-- 1. Identity
-- ---------------------------------------------------------------------------

alter table public.admin_asset_cleanup_jobs
  alter column operation_id drop not null,
  add column catalog_release_id text;

alter table public.admin_asset_cleanup_jobs
  add constraint admin_asset_cleanup_jobs_identity_check check (
    num_nonnulls(operation_id, catalog_release_id) = 1
  ),
  add constraint admin_asset_cleanup_jobs_catalog_release_format check (
    catalog_release_id is null
    or catalog_release_id ~ '^[A-Za-z0-9_-]{8,64}$'
  );

comment on column public.admin_asset_cleanup_jobs.catalog_release_id is
  'Immutable catalog release identity for catalog_document jobs; null for asset jobs.';

-- ---------------------------------------------------------------------------
-- 2. Target type
-- ---------------------------------------------------------------------------
-- The original check was declared inline and unnamed in
-- 20261015130000_automatic_apk_publication_foundation.sql, so PostgreSQL named
-- it `admin_asset_cleanup_jobs_target_type_check`. Verify the name before
-- dropping it rather than assuming: a renamed or renamed-away constraint must
-- fail loudly here, never silently leave the old vocabulary in place.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_asset_cleanup_jobs'::regclass
      and conname = 'admin_asset_cleanup_jobs_target_type_check'
  ) then
    raise exception
      'admin_asset_cleanup_jobs_target_type_check bulunamadı; hedef tipi daraltması uygulanamaz.';
  end if;
end
$$;

alter table public.admin_asset_cleanup_jobs
  drop constraint admin_asset_cleanup_jobs_target_type_check,
  add constraint admin_asset_cleanup_jobs_target_type_check check (
    target_type in (
      'apk_draft', 'apk', 'icon', 'screenshot', 'catalog_document'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Bucket / target / release identity must agree
-- ---------------------------------------------------------------------------

alter table public.admin_asset_cleanup_jobs
  add constraint admin_asset_cleanup_jobs_catalog_identity_check check (
    (bucket = 'catalog') = (target_type = 'catalog_document')
    and (bucket = 'catalog') = (catalog_release_id is not null)
  ),
  drop constraint admin_asset_cleanup_jobs_managed_path_check,
  add constraint admin_asset_cleanup_jobs_managed_path_check check (
    (
      bucket = 'apk-drafts'
      and target_type = 'apk_draft'
      and path ~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$'
    )
    or (
      bucket = 'apks'
      and target_type = 'apk'
      and path ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$'
    )
    or (
      bucket = 'app-assets'
      and target_type = 'icon'
      and path ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/icons/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    )
    or (
      bucket = 'app-assets'
      and target_type = 'screenshot'
      and path ~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/screenshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    )
    or (
      bucket = 'catalog'
      and target_type = 'catalog_document'
      and catalog_release_id is not null
      and path ~ '^releases/[A-Za-z0-9_-]{8,64}/(apps|categories)\.json$'
      and split_part(path, '/', 2) = catalog_release_id
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Release-scoped diagnostics index
-- ---------------------------------------------------------------------------

create index admin_asset_cleanup_jobs_catalog_release_idx
  on public.admin_asset_cleanup_jobs (catalog_release_id, path)
  where catalog_release_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Event vocabulary
-- ---------------------------------------------------------------------------

alter table public.admin_asset_cleanup_events
  drop constraint admin_asset_cleanup_events_outcome_check,
  add constraint admin_asset_cleanup_events_outcome_check check (outcome in (
    'claimed', 'started', 'released', 'completed', 'failed', 'skipped',
    'quarantined', 'requeued', 'orphan_enqueued', 'race_detected',
    'catalog_enqueued'
  ));
