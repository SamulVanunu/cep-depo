begin;

select plan(16);

select is(
  (select supports_mobile from public.app_versions where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  true,
  'legacy versions backfill mobile support'
);

select is(
  (select supports_tv from public.app_versions where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  false,
  'legacy versions default to no TV support'
);

select is(
  (select account_requirement::text from public.app_versions where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  'none',
  'legacy versions default to no account requirement'
);

select throws_ok(
  $$insert into public.app_versions (app_id, version_name, version_code, apk_path, apk_size_bytes, sha256, supports_mobile, supports_tv)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'invalid', 99,
      'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/versions/99999999-9999-4999-8999-999999999999.apk',
      100, repeat('f', 64), false, false)$$,
  '23514',
  null,
  'at least one platform is required'
);

select throws_ok(
  $$select * from public.search_catalog('', null, 'popular', 'watch')$$,
  '22023',
  null,
  'search rejects an invalid platform'
);

update public.app_versions
set supports_mobile = false, supports_tv = true
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

select results_eq(
  $$select app_id from public.search_catalog('', null, 'popular', 'tv')$$,
  $$values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid)$$,
  'TV filter uses the latest published version'
);

update public.app_versions
set status = 'withdrawn', published_at = now()
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

select is_empty(
  $$select app_id from public.search_catalog('', null, 'popular', 'tv')$$,
  'withdrawn latest TV version is excluded'
);

update public.apps
set package_name = 'com.cepdepo.app'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

update public.app_versions
set status = 'withdrawn', published_at = now()
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

update public.app_versions
set package_name = 'com.cepdepo.app', status = 'published', published_at = now(), version_code = 7
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

select results_eq(
  $$select version_code from public.get_latest_app_release('com.cepdepo.app')$$,
  $$values (7)$$,
  'release RPC returns the highest published package version'
);

select is_empty(
  $$select version_code from public.get_latest_app_release('com.unknown.app')$$,
  'release RPC hides unknown packages'
);

select throws_ok(
  $$insert into public.apps (category_id, slug, title, short_description, description, package_name)
    values ('11111111-1111-4111-8111-111111111111', 'duplicate-package', 'Duplicate', 'Duplicate package test', 'Duplicate package test description', 'com.cepdepo.app')$$,
  '23505',
  null,
  'package names are unique when present'
);

select ok(has_function_privilege('anon', 'public.get_latest_app_release(text)'::regprocedure, 'execute'), 'anon can read releases');
select ok(has_function_privilege('authenticated', 'public.get_latest_app_release(text)'::regprocedure, 'execute'), 'authenticated can read releases');
select ok(not has_table_privilege('anon', 'public.app_versions', 'insert,update,delete'), 'anon cannot mutate versions');
select ok(not has_table_privilege('authenticated', 'public.app_versions', 'insert,update,delete'), 'authenticated cannot mutate versions');
select ok(not has_function_privilege('public', 'public.get_latest_app_release(text)'::regprocedure, 'execute'), 'public has no release RPC execute grant');
select ok(has_function_privilege('anon', 'public.search_catalog(text,text,text,text)'::regprocedure, 'execute'), 'anon can execute platform search');

select * from finish();
rollback;
