create extension if not exists dblink with schema extensions;

begin;

select plan(34);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'd0000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'replace-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"replace_admin"}'::jsonb, now(), now()
  ),
  (
    'd0000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'replace-user@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"replace_user"}'::jsonb, now(), now()
  );

insert into public.user_roles (user_id, role)
values ('d0000000-0000-4000-8000-000000000001', 'admin');

insert into public.categories (id, name, slug)
values ('d1000000-0000-4000-8000-000000000001', 'Publish Replace', 'publish-replace');

insert into public.apps (
  id, category_id, slug, title, short_description, description, icon_path,
  package_name, status
)
values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
   'replace-first', 'Replace First', 'First publication test application.',
   'First publication test application description.', 'apps/d2000000-0000-4000-8000-000000000001/icons/d9000000-0000-4000-8000-000000000001.png',
   null, 'archived'),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001',
   'replace-existing', 'Replace Existing', 'Existing publication test application.',
   'Existing publication test application description.', null,
   'com.example.existing', 'active'),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001',
   'replace-legacy', 'Replace Legacy', 'Legacy publication test application.',
   'Legacy publication test application description.', null, null, 'active'),
  ('d2000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001',
   'replace-mismatch', 'Replace Mismatch', 'Package mismatch test application.',
   'Package mismatch test application description.', null,
   'com.example.expected', 'active'),
  ('d2000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001',
   'replace-lower', 'Replace Lower', 'Version ordering test application.',
   'Version ordering test application description.', null,
   'com.example.ordering', 'active'),
  ('d2000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000001',
   'replace-invalid-storage', 'Replace Invalid Storage', 'Storage validation test application.',
   'Storage validation test application description.', null,
   'com.example.storage', 'active'),
  ('d2000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000001',
   'replace-external', 'Replace External', 'External publication test application.',
   'External publication test application description.', 'apps/d2000000-0000-4000-8000-000000000007/icons/d9000000-0000-4000-8000-000000000007.png',
   'com.example.external', 'active'),
  ('d2000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000001',
   'replace-null-package', 'Replace Null Package', 'Missing package test application.',
   'Missing package test application description.', null, null, 'active'),
  ('d2000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000001',
   'replace-no-icon', 'Replace No Icon', 'Missing icon test application.',
   'Missing icon test application description.', null,
   'com.example.noicon', 'archived');

insert into public.app_versions (
  id, app_id, version_name, version_code, package_name, download_source,
  apk_path, apk_url, apk_size_bytes, sha256, status, published_at
)
values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', '1.0', 1, 'com.example.first', 'storage',
   'apps/d2000000-0000-4000-8000-000000000001/versions/d3000000-0000-4000-8000-000000000001.apk', null, 1001, repeat('1', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', '1.0', 10, 'com.example.existing', 'storage',
   'apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000002.apk', null, 1002, repeat('2', 64), 'published', now()),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', '1.1', 11, 'com.example.existing', 'external',
   null, 'https://downloads.example.com/existing-11.apk', 1003, repeat('3', 64), 'published', now()),
  ('d3000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000002', '2.0', 12, 'com.example.existing', 'storage',
   'apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000004.apk', null, 1004, repeat('4', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000003', '1.0', 1, null, 'external',
   null, 'https://downloads.example.com/legacy-1.apk', 1005, repeat('5', 64), 'published', now()),
  ('d3000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000003', '2.0', 2, 'com.example.legacy', 'external',
   null, 'https://downloads.example.com/legacy-2.apk', 1006, repeat('6', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-000000000004', '2.0', 2, 'com.example.wrong', 'external',
   null, 'https://downloads.example.com/wrong.apk', 1007, repeat('7', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000008', 'd2000000-0000-4000-8000-000000000005', '5.0', 5, 'com.example.ordering', 'external',
   null, 'https://downloads.example.com/order-5.apk', 1008, repeat('8', 64), 'published', now()),
  ('d3000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000005', '4.0', 4, 'com.example.ordering', 'external',
   null, 'https://downloads.example.com/order-4.apk', 1009, repeat('9', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000010', 'd2000000-0000-4000-8000-000000000006', '1.0', 1, 'com.example.storage', 'storage',
   'apps/d2000000-0000-4000-8000-000000000006/versions/d3000000-0000-4000-8000-000000000010.apk', null, 1010, repeat('a', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000011', 'd2000000-0000-4000-8000-000000000007', '1.0', 1, 'com.example.external', 'external',
   null, 'https://downloads.example.com/external.apk', 1011, repeat('b', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000012', 'd2000000-0000-4000-8000-000000000008', '1.0', 1, null, 'external',
   null, 'https://downloads.example.com/null-package.apk', 1012, repeat('c', 64), 'draft', null),
  ('d3000000-0000-4000-8000-000000000013', 'd2000000-0000-4000-8000-000000000009', '1.0', 1, 'com.example.noicon', 'external',
   null, 'https://downloads.example.com/no-icon.apk', 1013, repeat('d', 64), 'draft', null);

insert into storage.objects (bucket_id, name, metadata)
values
  ('apks', 'apps/d2000000-0000-4000-8000-000000000001/versions/d3000000-0000-4000-8000-000000000001.apk',
   '{"size":1001,"mimetype":"application/vnd.android.package-archive"}'::jsonb),
  ('apks', 'apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000002.apk',
   '{"size":1002,"mimetype":"application/octet-stream"}'::jsonb),
  ('apks', 'apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000004.apk',
   '{"size":1004,"mimetype":"application/vnd.android.package-archive"}'::jsonb),
  ('apks', 'apps/d2000000-0000-4000-8000-000000000006/versions/d3000000-0000-4000-8000-000000000010.apk',
   '{"size":9999,"mimetype":"text/plain"}'::jsonb);

select ok(
  not has_function_privilege('anon', 'public.admin_publish_version_replacing_previous(uuid,uuid)', 'EXECUTE'),
  'anonymous clients cannot execute replacement publication'
);
select ok(
  not has_function_privilege('authenticated', 'public.admin_publish_version_replacing_previous(uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot execute replacement publication'
);
select ok(
  has_function_privilege('service_role', 'public.admin_publish_version_replacing_previous(uuid,uuid)', 'EXECUTE'),
  'the service role can execute replacement publication'
);

set local role service_role;

select throws_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000002',
      'd3000000-0000-4000-8000-000000000001'
    )$$,
  'P0001', 'Yönetici yetkisi doğrulanamadı.',
  'the RPC independently requires an admin actor'
);

select results_eq(
  $$select unnest(public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001'
    ))$$,
  $$select null::text where false$$,
  'a first publication has no old Storage APK path to return'
);
select results_eq(
  $$select status::text, package_name from public.apps
    where id = 'd2000000-0000-4000-8000-000000000001'$$,
  $$values ('active'::text, 'com.example.first'::text)$$,
  'first publication activates the app and establishes package identity'
);
select results_eq(
  $$select status::text, published_at is not null from public.app_versions
    where id = 'd3000000-0000-4000-8000-000000000001'$$,
  $$values ('published'::text, true)$$,
  'first publication publishes the verified candidate'
);
select is(
  (select count(*)::integer from public.admin_audit_logs
   where target_id = 'd3000000-0000-4000-8000-000000000001'
     and action in ('version.publish', 'version.replace')),
  2,
  'first publication writes publication and replacement audits'
);
select is(
  (select count(*)::integer from public.admin_audit_logs
   where target_id = 'd2000000-0000-4000-8000-000000000001'
     and action = 'app.activate'),
  1,
  'archived app activation is audited in the same transaction'
);

select results_eq(
  $$select unnest(public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000004'
    ))$$,
  $$values ('apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000002.apk'::text)$$,
  'replacement returns only the old managed Storage APK path'
);
select results_eq(
  $$select id from public.app_versions
    where app_id = 'd2000000-0000-4000-8000-000000000002'$$,
  $$values ('d3000000-0000-4000-8000-000000000004'::uuid)$$,
  'successful replacement deletes every other version row only after publishing the candidate'
);
select ok(
  exists (
    select 1 from storage.objects
    where bucket_id = 'apks'
      and name = 'apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000002.apk'
  ),
  'the SQL transaction never deletes the old Storage object'
);
select results_eq(
  $$select bucket, path, operation_id, target_type, completed_at is null
    from public.admin_asset_cleanup_jobs
    where bucket = 'apks'
      and path = 'apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000002.apk'$$,
  $$values (
    'apks'::text,
    'apps/d2000000-0000-4000-8000-000000000002/versions/d3000000-0000-4000-8000-000000000002.apk'::text,
    'd3000000-0000-4000-8000-000000000002'::uuid,
    'apk'::text,
    true
  )$$,
  'replacement transaction durably queues the old Storage APK before deleting its version row'
);
select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'asset.cleanup_pending'
     and target_id = 'd3000000-0000-4000-8000-000000000002'),
  1,
  'replacement transaction records one cleanup-pending audit for the durable job'
);
select ok(
  not exists (
    select 1 from public.admin_audit_logs
    where target_id = 'd3000000-0000-4000-8000-000000000004'
      and metadata::text like '%downloads.example.com%'
  ),
  'replacement audit never contains an external URL'
);
select results_eq(
  $$select metadata->>'old_version_code', metadata->>'new_version_code', metadata->>'download_source'
    from public.admin_audit_logs
    where action = 'version.replace'
      and target_id = 'd3000000-0000-4000-8000-000000000004'$$,
  $$values ('11'::text, '12'::text, 'storage'::text)$$,
  'replacement audit records only version ordering and source metadata'
);

select lives_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000006'
    )$$,
  'a legacy app may establish its package identity once'
);
select is(
  (select package_name from public.apps where id = 'd2000000-0000-4000-8000-000000000003'),
  'com.example.legacy',
  'the legacy package identity is retained after publication'
);

select throws_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000007'
    )$$,
  'P0001', 'APK paket kimliği uygulamayla eşleşmiyor.',
  'a package mismatch is rejected'
);
select is(
  (select count(*)::integer from public.app_versions
   where app_id = 'd2000000-0000-4000-8000-000000000004'),
  1,
  'a package mismatch leaves the candidate catalog row untouched'
);

select throws_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000009'
    )$$,
  'P0001', 'Sürüm kodu mevcut yayından büyük olmalıdır.',
  'a lower version code is rejected'
);
select results_eq(
  $$select id, status::text from public.app_versions
    where app_id = 'd2000000-0000-4000-8000-000000000005'
    order by version_code desc$$,
  $$values
      ('d3000000-0000-4000-8000-000000000008'::uuid, 'published'::text),
      ('d3000000-0000-4000-8000-000000000009'::uuid, 'draft'::text)$$,
  'a rejected lower candidate cannot disturb the current release'
);
select throws_ok(
  $$insert into public.app_versions (
      id, app_id, version_name, version_code, package_name, download_source,
      apk_path, apk_url, apk_size_bytes, sha256, status
    ) values (
      'd3000000-0000-4000-8000-000000000099',
      'd2000000-0000-4000-8000-000000000005',
      '5.0 duplicate', 5, 'com.example.ordering', 'external', null,
      'https://downloads.example.com/order-5-duplicate.apk', 1099,
      repeat('9', 64), 'draft'
    )$$,
  '23505', null,
  'an equal version code is rejected before it can compete with a published release'
);

select throws_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000010'
    )$$,
  'P0001', 'Yayımlanacak APK doğrulanamadı.',
  'Storage publication requires exact size and permitted MIME metadata'
);
select is(
  (select status::text from public.app_versions where id = 'd3000000-0000-4000-8000-000000000010'),
  'draft',
  'failed Storage validation leaves the candidate draft'
);
update public.app_versions
set apk_path = 'apps/d2000000-0000-4000-8000-000000000006/versions/d3000000-0000-4000-8000-000000000099.apk'
where id = 'd3000000-0000-4000-8000-000000000010';
insert into storage.objects (bucket_id, name, metadata)
values (
  'apks',
  'apps/d2000000-0000-4000-8000-000000000006/versions/d3000000-0000-4000-8000-000000000099.apk',
  '{"size":1010,"mimetype":"application/vnd.android.package-archive"}'::jsonb
);
select throws_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000010'
    )$$,
  'P0001', 'Yayımlanacak APK doğrulanamadı.',
  'a verified object at a noncanonical candidate path is rejected'
);

select lives_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000011'
    )$$,
  'an invariant-valid external candidate requires no Storage object'
);
select is(
  (select status::text from public.app_versions where id = 'd3000000-0000-4000-8000-000000000011'),
  'published',
  'the external candidate is published without remote deletion'
);

select throws_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000012'
    )$$,
  'P0001', 'APK paket kimliği zorunludur.',
  'a candidate without package identity cannot publish'
);
select throws_ok(
  $$select public.admin_publish_version_replacing_previous(
      'd0000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000013'
    )$$,
  'P0001', 'İlk yayın için uygulama ikonu zorunludur.',
  'an app without an icon cannot complete its first publication'
);

reset role;

-- Use committed fixtures in independent sessions so two genuine transactions
-- can queue behind the same app-row lock. The first queued candidate must win;
-- the second must re-read after the lock and fail without deleting the winner.
select extensions.dblink_connect(
  'replace_setup',
  'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable'
);
select extensions.dblink_exec('replace_setup', $remote$
  delete from public.admin_audit_logs where actor_id = 'de000000-0000-4000-8000-000000000001';
  delete from public.apps where id = 'de200000-0000-4000-8000-000000000001';
  delete from public.categories where id = 'de100000-0000-4000-8000-000000000001';
  delete from auth.users where id = 'de000000-0000-4000-8000-000000000001';
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    'de000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'replace-concurrent@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"replace_concurrent"}'::jsonb, now(), now()
  );
  insert into public.user_roles (user_id, role)
  values ('de000000-0000-4000-8000-000000000001', 'admin');
  insert into public.categories (id, name, slug)
  values ('de100000-0000-4000-8000-000000000001', 'Concurrent Replace', 'concurrent-replace');
  insert into public.apps (
    id, category_id, slug, title, short_description, description,
    package_name, status
  ) values (
    'de200000-0000-4000-8000-000000000001',
    'de100000-0000-4000-8000-000000000001',
    'concurrent-replace-app', 'Concurrent Replace App',
    'Concurrent replacement test application.',
    'Concurrent replacement test application description.',
    'com.example.concurrent', 'active'
  );
  insert into public.app_versions (
    id, app_id, version_name, version_code, package_name, download_source,
    apk_path, apk_url, apk_size_bytes, sha256, status, published_at
  ) values
    ('de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', '1.0', 1, 'com.example.concurrent', 'external', null, 'https://downloads.example.com/concurrent-1.apk', 2001, repeat('d', 64), 'published', now()),
    ('de300000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000001', '2.0', 2, 'com.example.concurrent', 'external', null, 'https://downloads.example.com/concurrent-2.apk', 2002, repeat('e', 64), 'draft', null),
    ('de300000-0000-4000-8000-000000000003', 'de200000-0000-4000-8000-000000000001', '3.0', 3, 'com.example.concurrent', 'external', null, 'https://downloads.example.com/concurrent-3.apk', 2003, repeat('f', 64), 'draft', null)
$remote$);
select extensions.dblink_disconnect('replace_setup');

select extensions.dblink_connect('replace_lock', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('replace_one', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('replace_two', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select extensions.dblink_exec('replace_lock', 'begin; update public.apps set package_name = package_name where id = ''de200000-0000-4000-8000-000000000001''');
select extensions.dblink_send_query('replace_one', $query$
  select public.admin_publish_version_replacing_previous(
    'de000000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000002'
  )::text
$query$);
select pg_sleep(0.1);
select extensions.dblink_send_query('replace_two', $query$
  select public.admin_publish_version_replacing_previous(
    'de000000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000003'
  )::text
$query$);
select pg_sleep(0.1);

select is(
  (select count(*)::integer
   from pg_stat_activity
   where query like '%admin_publish_version_replacing_previous%'
     and wait_event_type = 'Lock'),
  2,
  'both competing transactions genuinely wait on the held app-row lock'
);

select extensions.dblink_exec('replace_lock', 'commit');
select results_eq(
  $$select result from extensions.dblink_get_result('replace_one') as result(result text)$$,
  $$values ('{}'::text)$$,
  'the first queued candidate wins after the app lock is released'
);
select throws_ok(
  $$select result from extensions.dblink_get_result('replace_two') as result(result text)$$,
  'P0001', 'Sürüm bulunamadı.',
  'the losing candidate fails after serialization instead of deleting the winner'
);
select extensions.dblink_disconnect('replace_lock');
select extensions.dblink_disconnect('replace_one');
select extensions.dblink_disconnect('replace_two');

select extensions.dblink_connect('replace_verify', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select results_eq(
  $$select id, status from extensions.dblink(
      'replace_verify',
      'select id::text, status::text from public.app_versions where app_id = ''de200000-0000-4000-8000-000000000001'''
    ) as winner(id text, status text)$$,
  $$values ('de300000-0000-4000-8000-000000000002'::text, 'published'::text)$$,
  'exactly one candidate remains and the serialized winner stays published'
);
select extensions.dblink_exec('replace_verify', 'delete from public.admin_audit_logs where actor_id = ''de000000-0000-4000-8000-000000000001''; delete from public.apps where id = ''de200000-0000-4000-8000-000000000001''; delete from public.categories where id = ''de100000-0000-4000-8000-000000000001''; delete from auth.users where id = ''de000000-0000-4000-8000-000000000001''');
select extensions.dblink_disconnect('replace_verify');

select * from finish();
rollback;
