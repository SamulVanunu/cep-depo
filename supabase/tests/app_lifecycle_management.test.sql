create extension if not exists dblink with schema extensions;

begin;

select plan(38);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('e0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'lifecycle-admin@example.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"lifecycle_admin"}'::jsonb, now(), now()),
  ('e0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'lifecycle-user@example.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"lifecycle_user"}'::jsonb, now(), now());

insert into public.user_roles (user_id, role)
values ('e0000000-0000-4000-8000-000000000001', 'admin');

insert into public.categories (id, name, slug)
values ('e1000000-0000-4000-8000-000000000001', 'Lifecycle', 'lifecycle');

insert into public.apps (
  id, category_id, slug, title, short_description, description, icon_path,
  package_name, status
)
values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   'lifecycle-main', 'Lifecycle Main', 'Lifecycle test application.',
   'Lifecycle test application description.',
   'apps/e2000000-0000-4000-8000-000000000001/icons/e4000000-0000-4000-8000-000000000001.png',
   'com.example.lifecycle', 'active'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001',
   'lifecycle-no-icon', 'Lifecycle No Icon', 'Lifecycle test without icon.',
   'Lifecycle test application without an icon.', null, 'com.example.noicon', 'archived'),
  ('e2000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001',
   'lifecycle-no-version', 'Lifecycle No Version', 'Lifecycle test without version.',
   'Lifecycle test application without a version.',
   'apps/e2000000-0000-4000-8000-000000000003/icons/e4000000-0000-4000-8000-000000000003.webp',
   'com.example.noversion', 'archived'),
  ('e2000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001',
   'lifecycle-unrelated', 'Lifecycle Unrelated', 'Unrelated lifecycle application.',
   'Unrelated lifecycle application description.',
   'apps/e2000000-0000-4000-8000-000000000004/icons/e4000000-0000-4000-8000-000000000004.jpg',
   'com.example.unrelated', 'active');

insert into public.app_versions (
  id, app_id, version_name, version_code, package_name, download_source,
  apk_path, apk_url, apk_size_bytes, sha256, status, published_at
)
values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
   '1.0', 1, 'com.example.lifecycle', 'storage',
   'apps/e2000000-0000-4000-8000-000000000001/versions/e3000000-0000-4000-8000-000000000001.apk',
   null, 1001, repeat('1', 64), 'published', now()),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
   '2.0', 2, 'com.example.lifecycle', 'external', null,
   'https://downloads.example.com/lifecycle.apk', 1002, repeat('2', 64), 'draft', null),
  ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000002',
   '1.0', 1, 'com.example.noicon', 'external', null,
   'https://downloads.example.com/no-icon.apk', 1003, repeat('3', 64), 'published', now()),
  ('e3000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000004',
   '1.0', 1, 'com.example.unrelated', 'external', null,
   'https://downloads.example.com/unrelated.apk', 1004, repeat('4', 64), 'published', now());

insert into public.app_screenshots (id, app_id, path, alt_text, position)
values
  ('e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
   'apps/e2000000-0000-4000-8000-000000000001/screenshots/e5000000-0000-4000-8000-000000000001.webp',
   'Lifecycle screenshot', 0),
  ('e5000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000004',
   'apps/e2000000-0000-4000-8000-000000000004/screenshots/e5000000-0000-4000-8000-000000000004.webp',
   'Unrelated screenshot', 0);

insert into public.reviews (id, app_id, user_id, rating, body)
values ('e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000002', 5, 'Useful lifecycle review.');
insert into public.reports (id, reporter_id, app_id, version_id, reason, description)
values ('e7000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
        'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
        'diger', 'Lifecycle report details.');
insert into public.download_events (app_id, version_id, installation_id)
values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
        'e8000000-0000-4000-8000-000000000001');

insert into storage.objects (bucket_id, name, metadata)
values
  ('app-assets', 'apps/e2000000-0000-4000-8000-000000000001/icons/e4000000-0000-4000-8000-000000000001.png', '{}'),
  ('app-assets', 'apps/e2000000-0000-4000-8000-000000000001/screenshots/e5000000-0000-4000-8000-000000000001.webp', '{}'),
  ('apks', 'apps/e2000000-0000-4000-8000-000000000001/versions/e3000000-0000-4000-8000-000000000001.apk', '{}'),
  ('app-assets', 'apps/e2000000-0000-4000-8000-000000000004/icons/e4000000-0000-4000-8000-000000000004.jpg', '{}');

select ok(not has_function_privilege('anon', 'public.admin_set_app_publication_status(uuid,uuid,app_status)', 'EXECUTE'), 'anon cannot set publication status');
select ok(not has_function_privilege('authenticated', 'public.admin_set_app_publication_status(uuid,uuid,app_status)', 'EXECUTE'), 'authenticated cannot set publication status');
select ok(has_function_privilege('service_role', 'public.admin_set_app_publication_status(uuid,uuid,app_status)', 'EXECUTE'), 'service role can set publication status');
select ok(not has_function_privilege('anon', 'public.admin_delete_app_permanently(uuid,uuid,text)', 'EXECUTE'), 'anon cannot permanently delete');
select ok(not has_function_privilege('authenticated', 'public.admin_delete_app_permanently(uuid,uuid,text)', 'EXECUTE'), 'authenticated cannot permanently delete');
select ok(has_function_privilege('service_role', 'public.admin_delete_app_permanently(uuid,uuid,text)', 'EXECUTE'), 'service role can permanently delete');

set local role service_role;

select throws_ok(
  $$select public.admin_set_app_publication_status('e0000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'archived')$$,
  'P0001', 'Yönetici yetkisi doğrulanamadı.', 'status RPC independently requires admin authorization'
);
select throws_ok(
  $$select public.admin_delete_app_permanently('e0000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Lifecycle Main')$$,
  'P0001', 'Yönetici yetkisi doğrulanamadı.', 'delete RPC independently requires admin authorization'
);

select lives_ok(
  $$select public.admin_set_app_publication_status('e0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'archived')$$,
  'an active app can be unpublished'
);
select is((select status::text from public.apps where id = 'e2000000-0000-4000-8000-000000000001'), 'archived', 'unpublish archives the app');
select lives_ok(
  $$select public.admin_set_app_publication_status('e0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'archived')$$,
  'unpublish is idempotent'
);
select lives_ok(
  $$select public.admin_set_app_publication_status('e0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'active')$$,
  'an archived app with icon and published version can be republished'
);
select is((select status::text from public.apps where id = 'e2000000-0000-4000-8000-000000000001'), 'active', 'republish activates the app');
select lives_ok(
  $$select public.admin_set_app_publication_status('e0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'active')$$,
  'republish is idempotent'
);
select is((select count(*)::integer from public.admin_audit_logs where target_id = 'e2000000-0000-4000-8000-000000000001' and action in ('app.archive', 'app.activate')), 4, 'every requested lifecycle operation is audited');

select throws_ok(
  $$select public.admin_set_app_publication_status('e0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'active')$$,
  'P0001', 'Yayın için uygulama ikonu ve yayımlanmış sürüm zorunludur.', 'activation requires an icon'
);
select throws_ok(
  $$select public.admin_set_app_publication_status('e0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000003', 'active')$$,
  'P0001', 'Yayın için uygulama ikonu ve yayımlanmış sürüm zorunludur.', 'activation requires a published version'
);

select throws_ok(
  $$select public.admin_delete_app_permanently('e0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', ' lifecycle main ')$$,
  'P0001', 'Silme onayı uygulama adıyla eşleşmiyor.', 'typed confirmation must exactly match the title'
);
select ok(exists(select 1 from public.apps where id = 'e2000000-0000-4000-8000-000000000001'), 'confirmation mismatch preserves the app');

create temporary table lifecycle_delete_result (assets jsonb);
insert into lifecycle_delete_result
select public.admin_delete_app_permanently(
  'e0000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Lifecycle Main'
);
select results_eq(
  $$select asset->>'bucket', asset->>'path' from lifecycle_delete_result, jsonb_array_elements(assets) asset order by 1, 2$$,
  $$values
      ('apks'::text, 'apps/e2000000-0000-4000-8000-000000000001/versions/e3000000-0000-4000-8000-000000000001.apk'::text),
      ('app-assets'::text, 'apps/e2000000-0000-4000-8000-000000000001/icons/e4000000-0000-4000-8000-000000000001.png'::text),
      ('app-assets'::text, 'apps/e2000000-0000-4000-8000-000000000001/screenshots/e5000000-0000-4000-8000-000000000001.webp'::text)
    order by 1, 2$$,
  'delete returns only managed icon, screenshot, and Storage APK bucket/path pairs'
);
select ok((select assets::text from lifecycle_delete_result) not like '%downloads.example.com%', 'delete output omits external URLs');
select ok(not exists(select 1 from public.apps where id = 'e2000000-0000-4000-8000-000000000001'), 'the app is deleted');
select ok(not exists(select 1 from public.app_versions where app_id = 'e2000000-0000-4000-8000-000000000001'), 'versions cascade');
select ok(not exists(select 1 from public.app_screenshots where app_id = 'e2000000-0000-4000-8000-000000000001'), 'screenshots cascade');
select ok(not exists(select 1 from public.download_events where app_id = 'e2000000-0000-4000-8000-000000000001'), 'downloads cascade');
select ok(not exists(select 1 from public.reviews where app_id = 'e2000000-0000-4000-8000-000000000001'), 'comments/reviews cascade');
select ok(not exists(select 1 from public.reports where app_id = 'e2000000-0000-4000-8000-000000000001'), 'reports cascade');
select is((select count(*)::integer from public.admin_audit_logs where target_id = 'e2000000-0000-4000-8000-000000000001' and action = 'app.delete'), 1, 'delete audit persists after app deletion');
select is(
  (select count(*)::integer from public.admin_asset_cleanup_jobs
   where path like 'apps/e2000000-0000-4000-8000-000000000001/%'
     and completed_at is null),
  3,
  'delete transaction durably queues every returned managed Storage path'
);
select results_eq(
  $$select bucket, path from public.admin_asset_cleanup_jobs
    where path like 'apps/e2000000-0000-4000-8000-000000000001/%'
    order by bucket, path$$,
  $$select asset->>'bucket', asset->>'path'
    from lifecycle_delete_result, jsonb_array_elements(assets) asset
    order by 1, 2$$,
  'durable cleanup jobs exactly match the returned managed asset pairs'
);
select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'asset.cleanup_pending'
     and metadata->>'path' like 'apps/e2000000-0000-4000-8000-000000000001/%'),
  3,
  'delete transaction records one cleanup-pending audit per durable job'
);
select is((select count(*)::integer from storage.objects where name like 'apps/e2000000-0000-4000-8000-000000000001/%'), 3, 'SQL does not delete Storage objects');
select ok(exists(select 1 from public.apps where id = 'e2000000-0000-4000-8000-000000000004'), 'unrelated app data is preserved');
select ok(exists(select 1 from storage.objects where name = 'apps/e2000000-0000-4000-8000-000000000004/icons/e4000000-0000-4000-8000-000000000004.jpg'), 'unrelated Storage objects are preserved');

reset role;

-- A permanent delete queued before publish-replace must win the shared app-row
-- lock; replacement then re-reads and fails without recreating/corrupting data.
select extensions.dblink_connect('lifecycle_setup', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select extensions.dblink_exec('lifecycle_setup', $remote$
  delete from public.admin_audit_logs where actor_id = 'ee000000-0000-4000-8000-000000000001';
  delete from public.apps where id = 'ee200000-0000-4000-8000-000000000001';
  delete from public.categories where id = 'ee100000-0000-4000-8000-000000000001';
  delete from auth.users where id = 'ee000000-0000-4000-8000-000000000001';
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    'ee000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'lifecycle-concurrent@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"lifecycle_concurrent"}'::jsonb, now(), now()
  );
  insert into public.user_roles (user_id, role)
  values ('ee000000-0000-4000-8000-000000000001', 'admin');
  insert into public.categories (id, name, slug)
  values ('ee100000-0000-4000-8000-000000000001', 'Concurrent Lifecycle', 'concurrent-lifecycle');
  insert into public.apps (
    id, category_id, slug, title, short_description, description, icon_path,
    package_name, status
  ) values (
    'ee200000-0000-4000-8000-000000000001', 'ee100000-0000-4000-8000-000000000001',
    'concurrent-lifecycle-app', 'Concurrent Lifecycle App',
    'Concurrent lifecycle test application.',
    'Concurrent lifecycle test application description.',
    'apps/ee200000-0000-4000-8000-000000000001/icons/ee400000-0000-4000-8000-000000000001.png',
    'com.example.concurrent.lifecycle', 'active'
  );
  insert into public.app_versions (
    id, app_id, version_name, version_code, package_name, download_source,
    apk_path, apk_url, apk_size_bytes, sha256, status, published_at
  ) values
  (
    'ee300000-0000-4000-8000-000000000001', 'ee200000-0000-4000-8000-000000000001',
    '1.0', 1, 'com.example.concurrent.lifecycle', 'storage',
    'apps/ee200000-0000-4000-8000-000000000001/versions/ee300000-0000-4000-8000-000000000001.apk',
    null, 2001, repeat('e', 64), 'published', now()
  ),
  (
    'ee300000-0000-4000-8000-000000000002', 'ee200000-0000-4000-8000-000000000001',
    '2.0', 2, 'com.example.concurrent.lifecycle', 'external', null,
    'https://downloads.example.com/concurrent-lifecycle-2.apk', 2002,
    repeat('f', 64), 'draft', null
  )
$remote$);
select extensions.dblink_disconnect('lifecycle_setup');
select extensions.dblink_connect('lifecycle_lock', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('lifecycle_delete', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('lifecycle_replace', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select extensions.dblink_exec('lifecycle_lock', 'begin; update public.apps set package_name = package_name where id = ''ee200000-0000-4000-8000-000000000001''');
select extensions.dblink_send_query('lifecycle_delete', $query$
  select public.admin_delete_app_permanently(
    'ee000000-0000-4000-8000-000000000001',
    'ee200000-0000-4000-8000-000000000001',
    'Concurrent Lifecycle App'
  )::text
$query$);
select pg_sleep(0.1);
select extensions.dblink_send_query('lifecycle_replace', $query$
  select public.admin_publish_version_replacing_previous(
    'ee000000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000002'
  )::text
$query$);
select pg_sleep(0.1);
select is(
  (select count(*)::integer from pg_stat_activity
   where (query like '%admin_publish_version_replacing_previous%' or query like '%admin_delete_app_permanently%')
     and wait_event_type = 'Lock'),
  2,
  'concurrent delete and publish-replace transactions both wait on the held app-row lock'
);
select extensions.dblink_exec('lifecycle_lock', 'commit');
select results_eq(
  $$select result from extensions.dblink_get_result('lifecycle_delete') as result(result text)$$,
  $$values ('[{"path": "apps/ee200000-0000-4000-8000-000000000001/versions/ee300000-0000-4000-8000-000000000001.apk", "bucket": "apks"}, {"path": "apps/ee200000-0000-4000-8000-000000000001/icons/ee400000-0000-4000-8000-000000000001.png", "bucket": "app-assets"}]'::text)$$,
  'the queued permanent delete wins first and returns only its managed assets'
);
select throws_ok(
  $$select result from extensions.dblink_get_result('lifecycle_replace') as result(result text)$$,
  'P0001', 'Uygulama bulunamadı.',
  'publish-replace re-reads after delete serialization and cannot recreate a deleted app'
);
select extensions.dblink_disconnect('lifecycle_lock');
select extensions.dblink_disconnect('lifecycle_delete');
select extensions.dblink_disconnect('lifecycle_replace');
select extensions.dblink_connect('lifecycle_cleanup', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres sslmode=disable');
select results_eq(
  $$select app_count, version_count from extensions.dblink(
      'lifecycle_cleanup',
      'select count(*) filter (where id = ''ee200000-0000-4000-8000-000000000001'')::integer, (select count(*)::integer from public.app_versions where app_id = ''ee200000-0000-4000-8000-000000000001'') from public.apps'
    ) as state(app_count integer, version_count integer)$$,
  $$values (0, 0)$$,
  'delete-versus-replace serialization leaves no app or corrupted winner version'
);
select extensions.dblink_exec('lifecycle_cleanup', 'delete from public.admin_asset_cleanup_jobs where path like ''apps/ee200000-0000-4000-8000-000000000001/%''; delete from public.admin_audit_logs where actor_id = ''ee000000-0000-4000-8000-000000000001''; delete from public.categories where id = ''ee100000-0000-4000-8000-000000000001''; delete from auth.users where id = ''ee000000-0000-4000-8000-000000000001''');
select extensions.dblink_disconnect('lifecycle_cleanup');

select * from finish();
rollback;
