-- P1 — catalog pointer RPC and the central retention contract.
--
-- PostgreSQL is the single authority for the published catalog pointer.
-- Consumers (mobile, admin cleanup, rollback) resolve the current release and
-- the retention window through `public.get_catalog_pointer()`; the mutable
-- Storage manifest is never a fallback.
--
-- This migration is additive:
--
--   * `private.catalog_retention_generations()` is the only place that defines
--     how many generations stay available. It is immutable, pins an empty
--     search_path, and is not executable by the Data API roles. Callers reach
--     it through the SECURITY DEFINER pointer function.
--
--   * `public.get_catalog_pointer()` returns exactly the eight contract
--     columns. Tokens, leases, operation ids and maintenance state are never
--     selected. Inconsistent state fails closed with CDP15 instead of
--     returning a snapshot that does not match the history ledger.
--
-- `restore_epoch` and `reconciliation_required` are part of the pointer
-- contract from day one. Until P6 adds the state columns and the begin/finish
-- RPCs, the only truthful values are 0 and false; P6 replaces this function's
-- body with the column reads and leaves the return type unchanged.

create or replace function private.catalog_retention_generations()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 5;
$$;

revoke all on function private.catalog_retention_generations()
  from public, anon, authenticated, service_role;

create or replace function public.get_catalog_pointer()
returns table (
  generation bigint,
  release_id text,
  generated_at timestamptz,
  app_count integer,
  category_count integer,
  retained_from_generation bigint,
  restore_epoch bigint,
  reconciliation_required boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state public.catalog_publish_state%rowtype;
  v_head public.catalog_publish_history%rowtype;
  v_floor bigint;
  v_rows bigint;
  v_max bigint;
begin
  select *
    into v_state
    from public.catalog_publish_state
   where id = 1;

  if not found then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog pointer durumu bulunamadı.';
  end if;

  -- Generation zero is the only state with no history at all. A history row
  -- under a zero pointer means a restore or a bad write, not an empty catalog.
  if v_state.generation = 0 then
    if exists (select 1 from public.catalog_publish_history) then
      raise exception using
        errcode = 'CDP15',
        message = 'Katalog pointer sıfır nesildeyken geçmiş satırı var.';
    end if;

    return query
      select
        0::bigint,
        null::text,
        null::timestamptz,
        null::integer,
        null::integer,
        0::bigint,
        0::bigint,
        false;
    return;
  end if;

  -- The head row is the only row the pointer may describe.
  select *
    into v_head
    from public.catalog_publish_history as h
   where h.generation = v_state.generation;

  if not found then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog pointer''ının head geçmiş satırı yok.';
  end if;

  if v_head.release_id is distinct from v_state.current_release_id
     or v_head.generated_at is distinct from v_state.generated_at
     or v_head.app_count is distinct from v_state.app_count
     or v_head.category_count is distinct from v_state.category_count
  then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog pointer''ı head geçmiş satırıyla uyuşmuyor.';
  end if;

  -- Generations start at 1, are positive and unique, so count = max = head
  -- proves the whole range is present without trusting application code. The
  -- unique index supports this as an index-only scan.
  select count(*), max(h.generation)
    into v_rows, v_max
    from public.catalog_publish_history as h;

  if v_max is distinct from v_state.generation
     or v_rows <> v_state.generation
  then
    raise exception using
      errcode = 'CDP15',
      message = 'Katalog geçmişinde nesil boşluğu var.';
  end if;

  v_floor := greatest(
    0::bigint,
    v_state.generation
      - (private.catalog_retention_generations() - 1)::bigint
  );

  return query
    select
      v_state.generation,
      v_state.current_release_id,
      v_state.generated_at,
      v_state.app_count,
      v_state.category_count,
      v_floor,
      0::bigint,
      false;
end;
$$;

revoke all on function public.get_catalog_pointer()
  from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_pointer()
  to anon, authenticated, service_role;
