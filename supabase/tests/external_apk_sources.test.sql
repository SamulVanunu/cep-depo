begin;

select plan(15);

select results_eq(
  $$select unnest(enum_range(null::public.apk_download_source))::text$$,
  $$values ('storage'::text), ('external'::text)$$,
  'APK download sources are explicit and stable'
);

select is_empty(
  $$select id
    from public.app_versions
    where download_source <> 'storage'
       or apk_path is null
       or apk_url is not null$$,
  'existing versions are backfilled as Storage sources'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  'b0000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'external-admin@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"external_admin"}'::jsonb, now(), now()
);

insert into public.user_roles (user_id, role)
values ('b0000000-0000-4000-8000-000000000001', 'admin');

insert into public.categories (id, name, slug)
values ('b1000000-0000-4000-8000-000000000001', 'External APK', 'external-apk');

insert into public.apps (
  id, category_id, slug, title, short_description, description, status
)
values (
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'external-apk-app',
  'External APK App',
  'An application backed by a direct HTTPS APK.',
  'An archived application used to verify external APK publication.',
  'archived'
);

select lives_ok(
  $$insert into public.app_versions (
      id, app_id, version_name, version_code, changelog, download_source,
      apk_path, apk_url, apk_size_bytes, sha256, status
    ) values (
      'b3000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      '1.0.0', 1, 'External release', 'external',
      null, 'https://downloads.example.com/releases/app.apk',
      7654321, repeat('a', 64), 'draft'
    )$$,
  'a valid external draft is accepted without a Storage path'
);

select throws_ok(
  $$insert into public.app_versions (
      app_id, version_name, version_code, download_source,
      apk_path, apk_url, apk_size_bytes, sha256
    ) values (
      'b2000000-0000-4000-8000-000000000001', '1.0.1', 2, 'storage',
      'apps/b2000000-0000-4000-8000-000000000001/versions/b3000000-0000-4000-8000-000000000002.apk',
      'https://downloads.example.com/app.apk', 1, repeat('b', 64)
    )$$,
  '23514', null,
  'a Storage source cannot also carry an external URL'
);

select throws_ok(
  $$insert into public.app_versions (
      app_id, version_name, version_code, download_source,
      apk_path, apk_url, apk_size_bytes, sha256
    ) values (
      'b2000000-0000-4000-8000-000000000001', '1.0.2', 3, 'external',
      'apps/b2000000-0000-4000-8000-000000000001/versions/b3000000-0000-4000-8000-000000000003.apk',
      'https://downloads.example.com/app.apk', 1, repeat('c', 64)
    )$$,
  '23514', null,
  'an external source cannot also carry a Storage path'
);

select throws_ok(
  $$insert into public.app_versions (
      app_id, version_name, version_code, download_source,
      apk_path, apk_url, apk_size_bytes, sha256
    ) values (
      'b2000000-0000-4000-8000-000000000001', '1.0.3', 4, 'external',
      null, null, 1, repeat('d', 64)
    )$$,
  '23514', null,
  'an external source requires an APK URL'
);

select throws_ok(
  $$insert into public.app_versions (
      app_id, version_name, version_code, download_source,
      apk_path, apk_url, apk_size_bytes, sha256
    ) values (
      'b2000000-0000-4000-8000-000000000001', '1.0.4', 5, 'external',
      null, 'http://downloads.example.com/app.apk', 1, repeat('e', 64)
    )$$,
  '23514', null,
  'external APK URLs require HTTPS'
);

select throws_ok(
  $$insert into public.app_versions (
      app_id, version_name, version_code, download_source,
      apk_path, apk_url, apk_size_bytes, sha256
    ) values (
      'b2000000-0000-4000-8000-000000000001', '1.0.5', 6, 'external',
      null, 'https://user:password@downloads.example.com/app.apk', 1, repeat('f', 64)
    )$$,
  '23514', null,
  'external APK URLs reject credentials'
);

select throws_ok(
  $$insert into public.app_versions (
      app_id, version_name, version_code, download_source,
      apk_path, apk_url, apk_size_bytes, sha256
    ) values (
      'b2000000-0000-4000-8000-000000000001', '1.0.6', 7, 'external',
      null, 'https://downloads.example.com/app.apk?token=secret', 1, repeat('1', 64)
    )$$,
  '23514', null,
  'external APK URLs reject query strings'
);

select throws_ok(
  $$insert into public.app_versions (
      app_id, version_name, version_code, download_source,
      apk_path, apk_url, apk_size_bytes, sha256
    ) values (
      'b2000000-0000-4000-8000-000000000001', '1.0.7', 8, 'external',
      null, 'https://downloads.example.com/app.apk#fragment', 1, repeat('2', 64)
    )$$,
  '23514', null,
  'external APK URLs reject fragments'
);

set local role service_role;

do $$
begin
  perform public.admin_record_external_action(
    'b0000000-0000-4000-8000-000000000001',
    'version.draft',
    'version',
    'b3000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'download_source', 'external',
      'hostname', 'downloads.example.com',
      'apk_url', 'https://downloads.example.com/releases/app.apk'
    )
  );
end;
$$;

select results_eq(
  $$select
      metadata->>'download_source',
      metadata->>'hostname',
      metadata ? 'apk_url'
    from public.admin_audit_logs
    where action = 'version.draft'
      and target_id = 'b3000000-0000-4000-8000-000000000001'$$,
  $$values ('external'::text, 'downloads.example.com'::text, false)$$,
  'external draft audit keeps source and hostname but strips the complete URL'
);

select lives_ok(
  $$select public.admin_publish_version_and_activate_app(
      'b0000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001'
    )$$,
  'an external draft publishes without a Storage object'
);

select results_eq(
  $$select app.status::text, version.status::text
    from public.apps as app
    join public.app_versions as version on version.app_id = app.id
    where version.id = 'b3000000-0000-4000-8000-000000000001'$$,
  $$values ('active'::text, 'published'::text)$$,
  'external publication atomically activates its archived app'
);

select results_eq(
  $$select metadata->>'download_source', metadata ? 'apk_url'
    from public.admin_audit_logs
    where action = 'version.publish'
      and target_id = 'b3000000-0000-4000-8000-000000000001'$$,
  $$values ('external'::text, false)$$,
  'publication audit records the source without copying the external URL'
);

reset role;
set local role anon;

select results_eq(
  $$select download_source::text, apk_path, apk_url
    from public.catalog_app_cards
    where version_id = 'b3000000-0000-4000-8000-000000000001'$$,
  $$values (
      'external'::text,
      null::text,
      'https://downloads.example.com/releases/app.apk'::text
    )$$,
  'the anonymous catalog exposes only the matching external source reference'
);

reset role;
select * from finish();
rollback;
