begin;

select plan(12);

select has_table('public', 'categories', 'categories exists');
select has_table('public', 'apps', 'apps exists');
select has_table('public', 'app_versions', 'app_versions exists');
select has_table('public', 'app_screenshots', 'app_screenshots exists');

insert into storage.objects (bucket_id, name)
values
  ('apks', 'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.apk'),
  ('app-assets', 'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/icon.png'),
  ('apk-drafts', 'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/draft.apk');

set local role anon;

select results_eq(
  $$select slug::text from public.apps order by slug$$,
  array['cep-iptv', 'radyo-cep']::text[],
  'anon sees active apps only'
);

select results_eq(
  $$select version_code from public.app_versions order by version_code$$,
  array[10, 12, 20]::integer[],
  'anon sees published versions only'
);

select results_eq(
  $$select name from storage.objects where bucket_id in ('apks', 'app-assets') order by name$$,
  array[
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/icon.png',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.apk'
  ]::text[],
  'anon reads published APK and app assets'
);

select is_empty(
  $$select name from storage.objects where bucket_id = 'apk-drafts'$$,
  'anon cannot read draft APK objects'
);

select ok(
  not has_table_privilege('anon', 'public.apps', 'insert,update,delete'),
  'anon has no catalog write grants'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}',
  true
);

select ok(
  not has_table_privilege('authenticated', 'public.apps', 'insert,update,delete'),
  'authenticated non-admin has no app write grants'
);

select ok(
  not has_table_privilege('authenticated', 'public.app_versions', 'insert,update,delete'),
  'authenticated non-admin has no version write grants'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('apk-drafts', 'blocked.apk')$$,
  '42501',
  null,
  'authenticated non-admin cannot insert draft APK objects'
);

reset role;

select * from finish();
rollback;
