create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null check (
    action = any (array[
      'app.create', 'app.update', 'app.archive',
      'category.create', 'category.update',
      'asset.upload',
      'screenshot.create', 'screenshot.update', 'screenshot.delete',
      'version.draft', 'version.publish', 'version.withdraw',
      'upload.cleanup',
      'review.hide', 'review.show', 'review.delete',
      'report.resolve', 'report.dismiss',
      'user.suspend', 'user.activate', 'user.delete', 'user.recovery_request'
    ])
  ),
  target_type text not null check (char_length(target_type) between 1 and 40),
  target_id text not null check (char_length(target_id) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index admin_audit_logs_actor_created_idx
  on public.admin_audit_logs(actor_id, created_at desc);
create index admin_audit_logs_action_created_idx
  on public.admin_audit_logs(action, created_at desc);
create index reports_status_created_idx on public.reports(status, created_at);
create index reviews_moderation_created_idx
  on public.reviews(moderation_status, created_at desc);
create index app_versions_status_created_idx
  on public.app_versions(status, created_at desc);

alter table public.reports
  add constraint reports_admin_note_check check (
    admin_note is null
    or (
      admin_note = regexp_replace(admin_note, '^[[:space:]]+|[[:space:]]+$', '', 'g')
      and char_length(admin_note) between 1 and 2000
    )
  );

alter table public.admin_audit_logs enable row level security;

revoke all on public.admin_audit_logs from public, anon, authenticated, service_role;
grant select, insert on public.admin_audit_logs to service_role;

grant select on public.user_roles to authenticated;

create policy user_roles_self_read
  on public.user_roles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'apk-drafts',
  'apk-drafts',
  false,
  524288000,
  array['application/vnd.android.package-archive', 'application/octet-stream']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

grant usage on schema private to service_role;

create function private.require_admin_actor(p_actor_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_roles
    where user_id = p_actor_id
      and role = 'admin'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Yönetici yetkisi doğrulanamadı.';
  end if;
end;
$$;

revoke all on function private.require_admin_actor(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.require_admin_actor(uuid) to service_role;

create function public.admin_set_review_status(
  p_actor_id uuid,
  p_review_id uuid,
  p_status public.review_moderation_status
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_status public.review_moderation_status;
  audit_action text;
begin
  perform private.require_admin_actor(p_actor_id);

  select moderation_status
  into previous_status
  from public.reviews
  where id = p_review_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Yorum bulunamadı.';
  end if;

  if previous_status = p_status then
    return;
  end if;

  update public.reviews
  set moderation_status = p_status
  where id = p_review_id;

  audit_action = case p_status
    when 'hidden' then 'review.hide'
    else 'review.show'
  end;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    audit_action,
    'review',
    p_review_id::text,
    jsonb_build_object('old_status', previous_status, 'new_status', p_status)
  );
end;
$$;

create function public.admin_delete_hidden_review(
  p_actor_id uuid,
  p_review_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_admin_actor(p_actor_id);

  delete from public.reviews
  where id = p_review_id
    and moderation_status = 'hidden';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Yalnız gizli yorum kalıcı olarak silinebilir.';
  end if;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id)
  values (p_actor_id, 'review.delete', 'review', p_review_id::text);
end;
$$;

create function public.admin_close_report(
  p_actor_id uuid,
  p_report_id uuid,
  p_status public.report_status,
  p_admin_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_note text;
  audit_action text;
begin
  perform private.require_admin_actor(p_actor_id);

  normalized_note = nullif(
    regexp_replace(p_admin_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
    ''
  );

  if normalized_note is null then
    raise exception using errcode = 'P0001', message = 'Yönetici notu zorunludur.';
  end if;

  if char_length(normalized_note) > 2000 then
    raise exception using errcode = 'P0001', message = 'Yönetici notu 2000 karakteri aşamaz.';
  end if;

  if p_status not in ('resolved', 'dismissed') then
    raise exception using errcode = 'P0001', message = 'Geçersiz şikâyet durumu.';
  end if;

  update public.reports
  set status = p_status,
      admin_note = normalized_note,
      resolved_at = now()
  where id = p_report_id
    and status = 'open';

  if not found then
    raise exception using errcode = 'P0001', message = 'Açık şikâyet bulunamadı.';
  end if;

  audit_action = case p_status
    when 'resolved' then 'report.resolve'
    else 'report.dismiss'
  end;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    audit_action,
    'report',
    p_report_id::text,
    jsonb_build_object('new_status', p_status)
  );
end;
$$;

create function public.admin_set_profile_status(
  p_actor_id uuid,
  p_user_id uuid,
  p_status public.profile_status
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_status public.profile_status;
  audit_action text;
begin
  perform private.require_admin_actor(p_actor_id);

  if p_status = 'suspended' and exists (
    select 1
    from public.user_roles
    where user_id = p_user_id
      and role = 'admin'
  ) then
    raise exception using errcode = 'P0001', message = 'Yönetici hesabı askıya alınamaz.';
  end if;

  select status
  into previous_status
  from public.profiles
  where user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Kullanıcı profili bulunamadı.';
  end if;

  if previous_status = p_status then
    return;
  end if;

  update public.profiles
  set status = p_status
  where user_id = p_user_id;

  audit_action = case p_status
    when 'suspended' then 'user.suspend'
    else 'user.activate'
  end;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    audit_action,
    'user',
    p_user_id::text,
    jsonb_build_object('old_status', previous_status, 'new_status', p_status)
  );
end;
$$;

create function public.admin_publish_version(
  p_actor_id uuid,
  p_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.app_versions%rowtype;
begin
  perform private.require_admin_actor(p_actor_id);

  select *
  into target_version
  from public.app_versions
  where id = p_version_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Sürüm bulunamadı.';
  end if;

  if target_version.status = 'published' then
    return;
  end if;

  if target_version.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Yalnız taslak sürüm yayımlanabilir.';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'apks'
      and name = target_version.apk_path
      and coalesce((metadata->>'size')::bigint, 0) = target_version.apk_size_bytes
      and metadata->>'mimetype' in (
        'application/vnd.android.package-archive',
        'application/octet-stream'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Yayımlanacak APK doğrulanamadı.';
  end if;

  update public.app_versions
  set status = 'published',
      published_at = now()
  where id = p_version_id;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'version.publish',
    'version',
    p_version_id::text,
    jsonb_build_object('new_status', 'published')
  );
end;
$$;

create function public.admin_withdraw_version(
  p_actor_id uuid,
  p_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.version_status;
begin
  perform private.require_admin_actor(p_actor_id);

  select status
  into current_status
  from public.app_versions
  where id = p_version_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Sürüm bulunamadı.';
  end if;

  if current_status = 'withdrawn' then
    return;
  end if;

  if current_status <> 'published' then
    raise exception using errcode = 'P0001', message = 'Yalnız yayımlanmış sürüm geri çekilebilir.';
  end if;

  update public.app_versions
  set status = 'withdrawn'
  where id = p_version_id;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'version.withdraw',
    'version',
    p_version_id::text,
    jsonb_build_object('old_status', current_status, 'new_status', 'withdrawn')
  );
end;
$$;

create function public.admin_record_external_action(
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
    'app.create', 'app.update', 'app.archive',
    'category.create', 'category.update',
    'asset.upload',
    'screenshot.create', 'screenshot.update', 'screenshot.delete',
    'version.draft', 'upload.cleanup',
    'user.delete', 'user.recovery_request'
  ];
begin
  perform private.require_admin_actor(p_actor_id);

  if not p_action = any (external_actions) then
    raise exception using errcode = 'P0001', message = 'Geçersiz yönetim işlemi.';
  end if;

  expected_target_type = case
    when p_action like 'app.%' then 'app'
    when p_action like 'category.%' then 'category'
    when p_action = 'asset.upload' then 'asset'
    when p_action like 'screenshot.%' then 'screenshot'
    when p_action = 'version.draft' then 'version'
    when p_action = 'upload.cleanup' then 'upload'
    when p_action like 'user.%' then 'user'
  end;

  if p_target_type is distinct from expected_target_type then
    raise exception using errcode = 'P0001', message = 'İşlem ve hedef türü eşleşmiyor.';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Geçersiz audit metadata.';
  end if;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into safe_metadata
  from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as entry
  where entry.key = any (array[
    'old_status', 'new_status', 'status', 'version_code',
    'bucket', 'path', 'operation_id', 'partial'
  ]);

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (p_actor_id, p_action, p_target_type, p_target_id, safe_metadata)
  returning id into audit_id;

  return audit_id;
end;
$$;

revoke all on function public.admin_set_review_status(uuid, uuid, public.review_moderation_status)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_hidden_review(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_close_report(uuid, uuid, public.report_status, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_profile_status(uuid, uuid, public.profile_status)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_publish_version(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_withdraw_version(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_record_external_action(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_set_review_status(uuid, uuid, public.review_moderation_status)
  to service_role;
grant execute on function public.admin_delete_hidden_review(uuid, uuid)
  to service_role;
grant execute on function public.admin_close_report(uuid, uuid, public.report_status, text)
  to service_role;
grant execute on function public.admin_set_profile_status(uuid, uuid, public.profile_status)
  to service_role;
grant execute on function public.admin_publish_version(uuid, uuid)
  to service_role;
grant execute on function public.admin_withdraw_version(uuid, uuid)
  to service_role;
grant execute on function public.admin_record_external_action(uuid, text, text, text, jsonb)
  to service_role;
