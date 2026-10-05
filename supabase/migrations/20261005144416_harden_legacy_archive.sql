-- Archived prototype rows are retained for operator recovery only. Keep them
-- immutable through API roles, including service_role.
do $$
declare
  archived_table text;
begin
  foreach archived_table in array array[
    'legacy_admins',
    'legacy_apps',
    'legacy_release_events',
    'legacy_reviews'
  ]
  loop
    if to_regclass('public.' || archived_table) is not null then
      execute format(
        'revoke all on table public.%I from public, anon, authenticated, service_role',
        archived_table
      );
      execute format(
        'grant select on table public.%I to service_role',
        archived_table
      );
    end if;
  end loop;
end;
$$;
