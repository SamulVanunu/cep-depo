-- P8 — the cleanup seal learns the `catalog` bucket.
--
-- `cleanup_asset_is_referenced()` remains the single authority that can answer
-- "safe to delete" for a Storage object. The catalog branch answers from the
-- publish ledger, under the same global exclusive advisory lock and the same
-- P6 reconciliation gate as every other branch:
--
--   * current release                        -> referenced
--   * release at/above the retention floor   -> referenced (rollback targets)
--   * release below the floor                -> deletable
--   * release absent from history            -> referenced (fail closed)
--   * generation zero                        -> referenced (nothing was published)
--   * reconciliation active                  -> CDP20, no answer at all
--   * ledger inconsistency                   -> CDP15 from get_catalog_pointer()
--
-- Anything that is not one of the two immutable release documents is refused
-- with P0001, never answered as safe. The function stays SECURITY INVOKER and
-- keeps its empty search_path; `get_catalog_pointer()` is SECURITY DEFINER and
-- is executable by service_role, so the invoker still reads the ledger through
-- the audited contract.

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
