begin;

select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'transition-admin@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"transition_admin"}'::jsonb, now(), now()
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'transition-user@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"transition_user"}'::jsonb, now(), now()
  );

insert into public.user_roles (user_id, role)
values ('a2000000-0000-4000-8000-000000000001', 'admin');

insert into public.categories (id, name, slug)
values ('a2100000-0000-4000-8000-000000000001', 'Admin Test', 'admin-test');

insert into public.apps (
  id, category_id, slug, title, short_description, description, status
)
values (
  'a2200000-0000-4000-8000-000000000001',
  'a2100000-0000-4000-8000-000000000001',
  'admin-transition-app',
  'Admin Transition App',
  'An application used for admin transition tests.',
  'An application used to verify audited admin state transitions.',
  'active'
), (
  'a2200000-0000-4000-8000-000000000002',
  'a2100000-0000-4000-8000-000000000001',
  'admin-archived-app',
  'Admin Archived App',
  'An archived application used for publication tests.',
  'An archived application used to verify atomic publication and activation.',
  'archived'
);

insert into public.app_versions (
  id, app_id, version_name, version_code, changelog, apk_path,
  apk_size_bytes, sha256, status
)
values
  (
    'a2300000-0000-4000-8000-000000000001',
    'a2200000-0000-4000-8000-000000000001',
    '1.0.0', 1, 'Initial version',
    'apps/a2200000-0000-4000-8000-000000000001/versions/a2300000-0000-4000-8000-000000000001.apk',
    12345, repeat('1', 64), 'draft'
  ),
  (
    'a2300000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000001',
    '2.0.0', 2, 'Missing APK',
    'apps/a2200000-0000-4000-8000-000000000001/versions/a2300000-0000-4000-8000-000000000002.apk',
    54321, repeat('2', 64), 'draft'
  ),
  (
    'a2300000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000002',
    '3.0.0', 3, 'Atomic publication',
    'apps/a2200000-0000-4000-8000-000000000002/versions/a2300000-0000-4000-8000-000000000003.apk',
    33333, repeat('3', 64), 'draft'
  ),
  (
    'a2300000-0000-4000-8000-000000000004',
    'a2200000-0000-4000-8000-000000000002',
    '4.0.0', 4, 'Missing atomic APK',
    'apps/a2200000-0000-4000-8000-000000000002/versions/a2300000-0000-4000-8000-000000000004.apk',
    44444, repeat('4', 64), 'draft'
  );

insert into storage.objects (bucket_id, name, metadata)
values
  (
    'apks',
    'apps/a2200000-0000-4000-8000-000000000001/versions/a2300000-0000-4000-8000-000000000001.apk',
    '{"size":12345,"mimetype":"application/vnd.android.package-archive"}'::jsonb
  ),
  (
    'apks',
    'apps/a2200000-0000-4000-8000-000000000002/versions/a2300000-0000-4000-8000-000000000003.apk',
    '{"size":33333,"mimetype":"application/vnd.android.package-archive"}'::jsonb
  );

insert into public.reviews (id, app_id, user_id, rating, body)
values (
  'a2400000-0000-4000-8000-000000000001',
  'a2200000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  4,
  'Transition review'
);

insert into public.reports (id, reporter_id, app_id, reason, description)
values (
  'a2500000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  'a2200000-0000-4000-8000-000000000001',
  'link_bozuk',
  'The link needs review'
);

set local role service_role;

select throws_ok(
  $$select public.admin_close_report(
    'a2000000-0000-4000-8000-000000000001',
    'a2500000-0000-4000-8000-000000000001',
    'resolved',
    '   '
  )$$,
  'P0001',
  'Yönetici notu zorunludur.',
  'closing a report requires a non-empty trimmed note'
);

select throws_ok(
  $$select public.admin_close_report(
    'a2000000-0000-4000-8000-000000000001',
    'a2500000-0000-4000-8000-000000000001',
    'resolved',
    repeat('x', 2001)
  )$$,
  'P0001',
  'Yönetici notu 2000 karakteri aşamaz.',
  'closing a report rejects an oversized admin note'
);

select throws_ok(
  $$select public.admin_record_external_action(
    'a2000000-0000-4000-8000-000000000001',
    'user.delete',
    'app',
    'a2200000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )$$,
  'P0001',
  'İşlem ve hedef türü eşleşmiyor.',
  'external audit actions reject mismatched target types'
);

select lives_ok(
  $$select public.admin_close_report(
    'a2000000-0000-4000-8000-000000000001',
    'a2500000-0000-4000-8000-000000000001',
    'resolved',
    '  Bağlantı yenilendi.  '
  )$$,
  'an open report can be resolved by an admin'
);

select results_eq(
  $$select status::text, admin_note, resolved_at is not null
    from public.reports
    where id = 'a2500000-0000-4000-8000-000000000001'$$,
  $$values ('resolved'::text, 'Bağlantı yenilendi.'::text, true)$$,
  'report resolution stores normalized note and timestamp'
);

select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'report.resolve' and target_id = 'a2500000-0000-4000-8000-000000000001'),
  1,
  'report resolution writes one audit row'
);

select lives_ok(
  $$select public.admin_set_review_status(
    'a2000000-0000-4000-8000-000000000001',
    'a2400000-0000-4000-8000-000000000001',
    'hidden'
  )$$,
  'an admin can hide a visible review'
);

select is(
  (select moderation_status::text from public.reviews
   where id = 'a2400000-0000-4000-8000-000000000001'),
  'hidden',
  'review status is changed to hidden'
);

select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'review.hide' and target_id = 'a2400000-0000-4000-8000-000000000001'),
  1,
  'review hiding writes one audit row'
);

select throws_ok(
  $$select public.admin_publish_version(
    'a2000000-0000-4000-8000-000000000001',
    'a2300000-0000-4000-8000-000000000002'
  )$$,
  'P0001',
  'Yayımlanacak APK doğrulanamadı.',
  'a draft without its canonical public APK cannot be published'
);

select lives_ok(
  $$select public.admin_publish_version(
    'a2000000-0000-4000-8000-000000000001',
    'a2300000-0000-4000-8000-000000000001'
  )$$,
  'a verified draft version can be published'
);

select results_eq(
  $$select status::text, published_at is not null
    from public.app_versions
    where id = 'a2300000-0000-4000-8000-000000000001'$$,
  $$values ('published'::text, true)$$,
  'publication sets status and published timestamp together'
);

select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'version.publish' and target_id = 'a2300000-0000-4000-8000-000000000001'),
  1,
  'publication writes one audit row'
);

select throws_ok(
  $$select public.admin_publish_version_and_activate_app(
    'a2000000-0000-4000-8000-000000000001',
    'a2300000-0000-4000-8000-000000000004'
  )$$,
  'P0001',
  'Yayımlanacak APK doğrulanamadı.',
  'atomic publication rejects a draft without its canonical APK'
);

select results_eq(
  $$select app.status::text, version.status::text
    from public.apps as app
    join public.app_versions as version on version.app_id = app.id
    where app.id = 'a2200000-0000-4000-8000-000000000002'
      and version.id = 'a2300000-0000-4000-8000-000000000004'$$,
  $$values ('archived'::text, 'draft'::text)$$,
  'failed atomic publication leaves both app and version unchanged'
);

select lives_ok(
  $$select public.admin_publish_version_and_activate_app(
    'a2000000-0000-4000-8000-000000000001',
    'a2300000-0000-4000-8000-000000000003'
  )$$,
  'a verified draft can be published and its app activated atomically'
);

select results_eq(
  $$select app.status::text, version.status::text
    from public.apps as app
    join public.app_versions as version on version.app_id = app.id
    where app.id = 'a2200000-0000-4000-8000-000000000002'
      and version.id = 'a2300000-0000-4000-8000-000000000003'$$,
  $$values ('active'::text, 'published'::text)$$,
  'atomic publication changes both states together'
);

select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'version.publish' and target_id = 'a2300000-0000-4000-8000-000000000003'),
  1,
  'atomic publication writes one version audit row'
);

select is(
  (select metadata->>'download_source' from public.admin_audit_logs
   where action = 'version.publish' and target_id = 'a2300000-0000-4000-8000-000000000003'),
  'storage',
  'Storage publication records its explicit download source'
);

select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'app.activate' and target_id = 'a2200000-0000-4000-8000-000000000002'),
  1,
  'atomic publication writes one app activation audit row'
);

select lives_ok(
  $$select public.admin_publish_version_and_activate_app(
    'a2000000-0000-4000-8000-000000000001',
    'a2300000-0000-4000-8000-000000000003'
  )$$,
  'retrying atomic publication is idempotent'
);

select results_eq(
  $$select
      count(*) filter (where action = 'version.publish')::integer,
      count(*) filter (where action = 'app.activate')::integer
    from public.admin_audit_logs
    where target_id in (
      'a2300000-0000-4000-8000-000000000003',
      'a2200000-0000-4000-8000-000000000002'
    )$$,
  $$values (1, 1)$$,
  'retrying atomic publication does not duplicate audit rows'
);

create temporary table published_timestamp as
select published_at
from public.app_versions
where id = 'a2300000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_withdraw_version(
    'a2000000-0000-4000-8000-000000000001',
    'a2300000-0000-4000-8000-000000000001'
  )$$,
  'a published version can be withdrawn'
);

select results_eq(
  $$select version.status::text, version.published_at = saved.published_at
    from public.app_versions as version
    cross join published_timestamp as saved
    where version.id = 'a2300000-0000-4000-8000-000000000001'$$,
  $$values ('withdrawn'::text, true)$$,
  'withdrawal preserves the original published timestamp'
);

select is(
  (select count(*)::integer from public.admin_audit_logs
   where action = 'version.withdraw' and target_id = 'a2300000-0000-4000-8000-000000000001'),
  1,
  'withdrawal writes one audit row'
);

reset role;
select * from finish();
rollback;
