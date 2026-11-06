-- P8.1 — the cleanup seal also protects the release named by the legacy
-- manifest pointer.
--
-- P8 originally treated `catalog_publish_state.legacy_manifest_release_id` as
-- sync metadata and ignored it (R1). That left a real gap: the mutable root
-- `manifest.json` can still point at an older release for legacy consumers, so
-- deleting that release would break every reader that has not moved to the
-- immutable pointer.
--
-- This migration keeps the P8 contract and only adds the missing reference:
--
--   * the seal still takes the same global exclusive advisory lock (20261101, 1)
--     before any read, so a manifest sync and a delete decision cannot cross;
--   * the pointer contract is still read through `get_catalog_pointer()`, so
--     reconciliation (CDP20) and ledger inconsistency (CDP15) behave unchanged;
--   * the legacy manifest metadata is read from the singleton state row under
--     the same lock. A missing row or partial metadata fails closed with CDP15
--     instead of returning "safe to delete";
--   * a release named by the legacy manifest is referenced exactly like the
--     current release or a retained generation;
--   * a null `legacy_manifest_release_id` means "no legacy reference recorded";
--     it does not weaken the existing ledger rules.
--
-- Only the catalog branch changes. The apks, app-assets and apk-drafts
-- branches are byte-for-byte the P8 implementation.

create or replace function public.cleanup_asset_is_referenced(p_bucket text, p_path text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_app_id uuid;
  v_version_id uuid;
  v_row_app_id uuid;
  v_match text[];
  v_result boolean;
  v_release_id text;
  v_generation bigint;
  v_current_release text;
  v_floor bigint;
  v_recon boolean;
  v_legacy_release text;
  v_legacy_generation bigint;
  v_legacy_synced_at timestamptz;
begin
  -- Seal before any read. Released when this transaction ends.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(20261101, 1);

  -- P6: a false answer here authorises a Storage DELETE. While reconciliation
  -- is open the worker cannot obtain that answer at all.
  if exists (
    select 1
    from public.catalog_publish_state as s
    where s.id = 1
      and s.reconciliation_required
  ) then
    raise exception using
      errcode = 'CDP20',
      message = 'Katalog uzlaştırması etkin; silme onayı verilemez.';
  end if;

  if p_bucket = 'apks' then
    -- Same pattern as app_versions_apk_path_check.
    if p_path !~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/versions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;

    v_match := regexp_match(
      p_path,
      '^apps/([0-9a-f-]{36})/versions/([0-9a-f-]{36})\.apk$'
    );
    v_app_id := v_match[1]::uuid;
    v_version_id := v_match[2]::uuid;

    select app_id into v_row_app_id
    from public.app_versions
    where id = v_version_id;

    if v_row_app_id is not null and v_row_app_id <> v_app_id then
      raise exception using errcode = 'P0001', message = 'Dosya sahipliği uyuşmuyor.';
    end if;

    select exists (
      select 1 from public.app_versions where apk_path = p_path
    ) into v_result;

  elsif p_bucket = 'app-assets' then
    if p_path !~ '^apps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(icons|screenshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;

    v_match := regexp_match(p_path, '^apps/([0-9a-f-]{36})/(icons|screenshots)/');
    v_app_id := v_match[1]::uuid;

    if v_match[2] = 'icons' then
      select id into v_row_app_id from public.apps where icon_path = p_path;
    else
      select app_id into v_row_app_id from public.app_screenshots where path = p_path;
    end if;

    if v_row_app_id is not null and v_row_app_id <> v_app_id then
      raise exception using errcode = 'P0001', message = 'Dosya sahipliği uyuşmuyor.';
    end if;

    select exists (
      select 1 from public.apps where icon_path = p_path
      union all
      select 1 from public.app_screenshots where path = p_path
    ) into v_result;

  elsif p_bucket = 'apk-drafts' then
    if p_path !~ '^operations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.apk$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;

    select exists (
      select 1
      from public.admin_audit_logs as audit
      join public.app_versions as version
        on version.id::text = audit.target_id
      where audit.action = 'version.draft'
        and audit.metadata->>'path' = p_path
        and version.status = 'draft'
    ) into v_result;

  elsif p_bucket = 'catalog' then
    -- Only the two immutable release documents exist. A prefix, a manifest or
    -- any other object in the bucket is not a supported cleanup target and
    -- must never be answered as safe.
    if p_path !~ '^releases/[A-Za-z0-9_-]{8,64}/(apps|categories)\.json$' then
      raise exception using errcode = 'P0001', message = 'Geçersiz dosya yolu.';
    end if;

    v_release_id := split_part(p_path, '/', 2);

    -- A separate PL/pgSQL statement: under Read Committed this reads a fresh
    -- snapshot after the exclusive lock was granted.
    select p.generation, p.release_id, p.retained_from_generation,
           p.reconciliation_required
      into v_generation, v_current_release, v_floor, v_recon
      from public.get_catalog_pointer() as p;

    -- The mutable root manifest's recorded release. This is read after the
    -- same global lock, so a manifest sync that follows the protocol cannot
    -- land between this read and the delete decision.
    select s.legacy_manifest_release_id,
           s.legacy_manifest_generation,
           s.legacy_manifest_synced_at
      into v_legacy_release, v_legacy_generation, v_legacy_synced_at
      from public.catalog_publish_state as s
     where s.id = 1;

    if not found then
      raise exception using
        errcode = 'CDP15',
        message = 'Katalog legacy manifest durumu bulunamadı; silme onayı verilemez.';
    end if;

    -- The three columns are all-or-nothing by constraint. If a future write or
    -- a restore breaks that invariant, the manifest reference is unreadable and
    -- the seal must fail closed instead of guessing which release is protected.
    if (v_legacy_release is null) <> (v_legacy_generation is null)
       or (v_legacy_release is null) <> (v_legacy_synced_at is null) then
      raise exception using
        errcode = 'CDP15',
        message = 'Katalog legacy manifest meta verisi eksik; silme onayı verilemez.';
    end if;

    if v_legacy_release is not null
       and v_legacy_release !~ '^[A-Za-z0-9_-]{8,64}$' then
      raise exception using
        errcode = 'CDP15',
        message = 'Katalog legacy manifest release kimliği geçersiz; silme onayı verilemez.';
    end if;

    -- The gate above already read the state while holding the lock; this is an
    -- assertion against the pointer contract, not a second line of defence.
    if v_recon then
      raise exception using
        errcode = 'CDP20',
        message = 'Katalog uzlaştırması etkin; silme onayı verilemez.';
    end if;

    if v_generation <= 0 then
      -- Nothing is published, so no release can be proven deletable.
      v_result := true;
    else
      v_result :=
        v_release_id = v_current_release
        or v_release_id = v_legacy_release
        or exists (
          select 1
          from public.catalog_publish_history as h
          where h.release_id = v_release_id
            and h.generation >= v_floor
        )
        or not exists (
          select 1
          from public.catalog_publish_history as h
          where h.release_id = v_release_id
        );
    end if;

  else
    raise exception using errcode = 'P0001', message = 'Geçersiz bucket.';
  end if;

  return coalesce(v_result, false);
end;
$$;

revoke all on function public.cleanup_asset_is_referenced(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_asset_is_referenced(text, text)
  to service_role;
