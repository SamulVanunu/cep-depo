begin;

select plan(41);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  'c0000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'foundation-admin@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"foundation_admin"}'::jsonb, now(), now()
);

insert into public.user_roles (user_id, role)
values ('c0000000-0000-4000-8000-000000000001', 'admin');

insert into public.categories (id, name, slug)
values ('c1000000-0000-4000-8000-000000000001', 'Foundation', 'foundation');

select lives_ok(
  $$insert into public.apps (
      id, category_id, slug, title, short_description, description, package_name
    ) values (
      'c2000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001',
      'legacy-foundation', 'Legacy Foundation',
      'Legacy package identity remains nullable.',
      'Legacy package identity remains nullable during migration.', null
    )$$,
  'legacy applications may retain a null package identity'
);

select lives_ok(
  $$insert into public.app_versions (
      id, app_id, version_name, version_code, package_name, apk_path,
      apk_size_bytes, sha256
    ) values (
      'c3000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      '1.0.0', 1, null,
      'apps/c2000000-0000-4000-8000-000000000001/versions/c3000000-0000-4000-8000-000000000001.apk',
      1024, repeat('a', 64)
    )$$,
  'legacy versions may retain a null package identity'
);

select lives_ok(
  $$update public.apps
    set package_name = 'com.example_foundation.release2'
    where id = 'c2000000-0000-4000-8000-000000000001'$$,
  'a trimmed Android package name with multiple Java-style segments is accepted'
);

select throws_ok(
  $$update public.apps set package_name = 'foundation'
    where id = 'c2000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a package name requires at least two segments'
);

select throws_ok(
  $$update public.apps set package_name = ' com.example.foundation '
    where id = 'c2000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a package name must already be trimmed'
);

select throws_ok(
  $$update public.apps set package_name = 'com.release-name'
    where id = 'c2000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'each package segment must be a Java-style identifier'
);

select lives_ok(
  $$update public.app_versions set package_name = 'com.example.foundation'
    where id = 'c3000000-0000-4000-8000-000000000001'$$,
  'a version accepts a valid package identity'
);

select throws_ok(
  $$update public.app_versions set package_name = '9com.example'
    where id = 'c3000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a version rejects an invalid package identity'
);

select has_table(
  'public', 'admin_asset_cleanup_jobs',
  'the service-managed cleanup queue exists'
);

select lives_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'apk-drafts',
      'operations/c4000000-0000-4000-8000-000000000001/source.apk',
      'c5000000-0000-4000-8000-000000000001', 'apk_draft'
    )$$,
  'a canonical temporary APK path is accepted'
);

select lives_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'apks',
      'apps/c2000000-0000-4000-8000-000000000001/versions/c3000000-0000-4000-8000-000000000002.apk',
      'c5000000-0000-4000-8000-000000000002', 'apk'
    )$$,
  'a canonical published APK path is accepted'
);

select lives_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'app-assets',
      'apps/c2000000-0000-4000-8000-000000000001/icons/c6000000-0000-4000-8000-000000000001.png',
      'c5000000-0000-4000-8000-000000000003', 'icon'
    )$$,
  'a canonical icon path is accepted'
);

select lives_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'app-assets',
      'apps/c2000000-0000-4000-8000-000000000001/screenshots/c6000000-0000-4000-8000-000000000002.webp',
      'c5000000-0000-4000-8000-000000000004', 'screenshot'
    )$$,
  'a canonical screenshot path is accepted'
);

select throws_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values ('avatars', 'c0000000/avatar.png', gen_random_uuid(), 'icon')$$,
  '23514', null,
  'cleanup rejects unmanaged buckets'
);

select throws_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values ('apk-drafts', 'operations/not-a-uuid/source.apk', gen_random_uuid(), 'apk_draft')$$,
  '23514', null,
  'cleanup rejects noncanonical temporary APK paths'
);

select throws_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values ('apks', '../unrelated.apk', gen_random_uuid(), 'apk')$$,
  '23514', null,
  'cleanup rejects noncanonical published APK paths'
);

select throws_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'app-assets',
      'apps/c2000000-0000-4000-8000-000000000001/icons/not-a-uuid.png',
      gen_random_uuid(), 'icon'
    )$$,
  '23514', null,
  'cleanup rejects noncanonical asset paths'
);

select throws_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'apks', 'https://github.com/example/releases/download/app.apk',
      gen_random_uuid(), 'apk'
    )$$,
  '23514', null,
  'cleanup can never target an external GitHub URL'
);

select throws_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'apk-drafts',
      'operations/c4000000-0000-4000-8000-000000000001/source.apk',
      gen_random_uuid(), 'apk_draft'
    )$$,
  '23505', null,
  'only one pending cleanup job may exist for an object'
);

update public.admin_asset_cleanup_jobs
set completed_at = now()
where bucket = 'apk-drafts'
  and path = 'operations/c4000000-0000-4000-8000-000000000001/source.apk';

select lives_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'apk-drafts',
      'operations/c4000000-0000-4000-8000-000000000001/source.apk',
      gen_random_uuid(), 'apk_draft'
    )$$,
  'a completed object may be queued again'
);

update public.admin_asset_cleanup_jobs
set updated_at = '2000-01-01 00:00:00+00', attempts = attempts + 1
where bucket = 'apk-drafts'
  and path = 'operations/c4000000-0000-4000-8000-000000000001/source.apk'
  and completed_at is null;

select ok(
  (select updated_at > '2000-01-01 00:00:00+00'::timestamptz
    from public.admin_asset_cleanup_jobs
    where bucket = 'apk-drafts'
      and path = 'operations/c4000000-0000-4000-8000-000000000001/source.apk'
      and completed_at is null),
  'cleanup job updates automatically refresh updated_at'
);

select is_empty(
  $$select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_asset_cleanup_jobs'
      and column_name in ('error', 'error_text', 'raw_error', 'url', 'external_url', 'signed_url', 'token')$$,
  'cleanup jobs have no raw error, URL, signed URL, or token field'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_asset_cleanup_jobs'::regclass),
  'cleanup jobs have RLS enabled'
);

select is(
  (select count(*)::integer from pg_policy
    where polrelid = 'public.admin_asset_cleanup_jobs'::regclass),
  0,
  'cleanup jobs have no public policies'
);

select ok(
  not has_table_privilege('anon', 'public.admin_asset_cleanup_jobs', 'SELECT,INSERT,UPDATE,DELETE'),
  'anonymous clients have no cleanup-job grants'
);

select ok(
  not has_table_privilege('authenticated', 'public.admin_asset_cleanup_jobs', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated clients have no cleanup-job grants'
);

select ok(
  has_table_privilege('service_role', 'public.admin_asset_cleanup_jobs', 'SELECT,INSERT,UPDATE,DELETE'),
  'the service role manages cleanup jobs'
);

set local role anon;
select throws_ok(
  $$select * from public.admin_asset_cleanup_jobs$$,
  '42501', null,
  'anonymous clients cannot read cleanup jobs'
);
reset role;

set local role authenticated;
select throws_ok(
  $$insert into public.admin_asset_cleanup_jobs
      (bucket, path, operation_id, target_type)
    values (
      'apks',
      'apps/c2000000-0000-4000-8000-000000000001/versions/c3000000-0000-4000-8000-000000000003.apk',
      gen_random_uuid(), 'apk'
    )$$,
  '42501', null,
  'authenticated clients cannot create cleanup jobs'
);
reset role;

set local role service_role;
select lives_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'app.delete', 'app', 'c2000000-0000-4000-8000-000000000001', '{}'
    );
    select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'version.replace', 'version', 'c3000000-0000-4000-8000-000000000001',
      '{"old_version_code":1,"new_version_code":2,"download_source":"external"}'
    );
    select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'asset.cleanup_pending', 'asset', 'c5000000-0000-4000-8000-000000000005',
      '{"bucket":"apks","path":"apps/c2000000-0000-4000-8000-000000000001/versions/c3000000-0000-4000-8000-000000000002.apk","operation_id":"c5000000-0000-4000-8000-000000000005"}'
    )$$,
  'the required lifecycle audit actions accept their expected target types'
);

select throws_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'asset.cleanup_pending', 'version', 'wrong-target', '{}'
    )$$,
  'P0001', 'İşlem ve hedef türü eşleşmiyor.',
  'cleanup audit actions reject a mismatched target type'
);

select throws_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'app.delete', 'app', 'https://example.com/app?token=secret', '{}'
    )$$,
  'P0001', 'Geçersiz audit hedef kimliği.',
  'app deletion audit target IDs must be UUIDs'
);

select throws_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'version.replace', 'version', 'secret-token', '{}'
    )$$,
  'P0001', 'Geçersiz audit hedef kimliği.',
  'version replacement audit target IDs must be UUIDs'
);

select throws_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'asset.cleanup_pending', 'asset', 'https://github.com/private.apk', '{}'
    )$$,
  'P0001', 'Geçersiz audit hedef kimliği.',
  'cleanup-pending audit target IDs must be UUIDs'
);

select throws_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'asset.cleanup_pending', 'asset', 'c5000000-0000-4000-8000-000000000007',
      '{"bucket":"apks","path":"apps/c2000000-0000-4000-8000-000000000001/icons/c6000000-0000-4000-8000-000000000007.png","operation_id":"c5000000-0000-4000-8000-000000000007"}'
    )$$,
  'P0001', 'Geçersiz cleanup audit metadata.',
  'cleanup-pending audit rejects a mismatched managed bucket and path'
);

select throws_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'asset.cleanup_pending', 'asset', 'c5000000-0000-4000-8000-000000000008',
      '{"bucket":"apks","path":"apps/c2000000-0000-4000-8000-000000000001/versions/c3000000-0000-4000-8000-000000000008.apk","operation_id":"c5000000-0000-4000-8000-000000000009"}'
    )$$,
  'P0001', 'Geçersiz cleanup audit metadata.',
  'cleanup-pending audit operation ID must equal its target ID'
);

select throws_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'asset.cleanup_pending', 'asset', 'c5000000-0000-4000-8000-000000000010',
      '{"operation_id":"c5000000-0000-4000-8000-000000000010"}'
    )$$,
  'P0001', 'Geçersiz cleanup audit metadata.',
  'cleanup-pending audit requires a complete bucket and path pair'
);

select results_eq(
  $$select
      metadata->>'old_version_code',
      metadata->>'new_version_code',
      metadata->>'download_source'
    from public.admin_audit_logs
    where action = 'version.replace'
      and target_id = 'c3000000-0000-4000-8000-000000000001'$$,
  $$values ('1'::text, '2'::text, 'external'::text)$$,
  'replacement audit retains only the required version/source metadata'
);

select results_eq(
  $$select
      metadata->>'bucket', metadata->>'path', metadata->>'operation_id'
    from public.admin_audit_logs
    where action = 'asset.cleanup_pending'
      and target_id = 'c5000000-0000-4000-8000-000000000005'$$,
  $$values (
      'apks'::text,
      'apps/c2000000-0000-4000-8000-000000000001/versions/c3000000-0000-4000-8000-000000000002.apk'::text,
      'c5000000-0000-4000-8000-000000000005'::text
    )$$,
  'cleanup audit retains canonical managed object identity'
);

select lives_ok(
  $$select public.admin_record_external_action(
      'c0000000-0000-4000-8000-000000000001',
      'version.draft', 'version', 'c3000000-0000-4000-8000-000000000006',
      '{"old_status":"raw database error: token=secret","new_status":123,"status":"https://example.com?token=secret","version_code":2147483648,"old_version_code":1.5,"new_version_code":"2","bucket":"https://github.com?token=secret","path":"https://github.com/example/private.apk?token=secret","operation_id":"not-a-uuid-token-secret","partial":"raw error token secret","download_source":"https://example.com?token=secret","hostname":"https://user:secret@example.com/path","apk_url":"https://github.com/example/private.apk?token=secret","signed_url":"https://storage.example/object?token=secret","token":"secret","raw_error":"authorization: bearer secret"}'
    )$$,
  'unsafe audit metadata is safely filtered rather than retained'
);

select results_eq(
  $$select metadata
    from public.admin_audit_logs
    where target_id = 'c3000000-0000-4000-8000-000000000006'$$,
  $$values ('{}'::jsonb)$$,
  'audit metadata strips invalid values disguised under every allowed key'
);

reset role;
select * from finish();
rollback;
