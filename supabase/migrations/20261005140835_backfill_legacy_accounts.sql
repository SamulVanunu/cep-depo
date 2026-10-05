-- Existing Auth users predate the profile trigger. Give them deterministic,
-- valid temporary usernames without changing or exposing their email addresses.
do $$
begin
  if to_regclass('public.profiles') is not null then
    insert into public.profiles (user_id, username)
    select
      auth_user.id,
      ('user_' || left(replace(auth_user.id::text, '-', ''), 25))::extensions.citext
    from auth.users as auth_user
    where not exists (
      select 1 from public.profiles as profile where profile.user_id = auth_user.id
    )
    on conflict (user_id) do nothing;
  end if;

  if to_regclass('public.user_roles') is not null
    and to_regclass('public.legacy_admins') is not null
  then
    insert into public.user_roles (user_id, role)
    select legacy_admin.user_id, 'admin'::public.app_role
    from public.legacy_admins as legacy_admin
    on conflict (user_id, role) do nothing;
  end if;
end;
$$;
