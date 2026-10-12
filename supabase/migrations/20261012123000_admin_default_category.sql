alter table public.categories
  add column is_default boolean not null default false,
  add constraint categories_default_active_check
    check (not is_default or is_active);

do $$
declare
  default_category_id uuid;
begin
  select id
  into default_category_id
  from public.categories
  where slug = 'genel'
  order by created_at, id
  limit 1;

  if default_category_id is null then
    insert into public.categories (name, slug, position, is_active, is_default)
    values ('Genel', 'genel', 0, true, true)
    returning id into default_category_id;
  else
    update public.categories
    set is_active = true,
        is_default = true
    where id = default_category_id;
  end if;
end;
$$;

create unique index categories_single_default_idx
  on public.categories (is_default)
  where is_default;

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_action_check,
  add constraint admin_audit_logs_action_check check (
    action = any (array[
      'app.create', 'app.update', 'app.archive', 'app.activate',
      'category.create', 'category.update',
      'asset.upload',
      'screenshot.create', 'screenshot.update', 'screenshot.delete',
      'version.draft', 'version.publish', 'version.withdraw',
      'upload.cleanup',
      'review.hide', 'review.show', 'review.delete',
      'report.resolve', 'report.dismiss',
      'user.suspend', 'user.activate', 'user.delete', 'user.recovery_request'
    ])
  );

create function public.admin_publish_version_and_activate_app(
  p_actor_id uuid,
  p_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_app_id uuid;
  previous_app_status public.app_status;
begin
  perform private.require_admin_actor(p_actor_id);

  select app_id
  into target_app_id
  from public.app_versions
  where id = p_version_id;

  perform public.admin_publish_version(p_actor_id, p_version_id);

  select status
  into previous_app_status
  from public.apps
  where id = target_app_id
  for update;

  if previous_app_status = 'archived' then
    update public.apps
    set status = 'active'
    where id = target_app_id;

    insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
    values (
      p_actor_id,
      'app.activate',
      'app',
      target_app_id::text,
      jsonb_build_object('old_status', 'archived', 'new_status', 'active')
    );
  end if;
end;
$$;

revoke all on function public.admin_publish_version_and_activate_app(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_publish_version_and_activate_app(uuid, uuid)
  to service_role;
