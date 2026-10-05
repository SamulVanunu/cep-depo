begin;

select plan(4);

select is(
  (
    select public::text || ':' || file_size_limit::text || ':' || array_to_string(allowed_mime_types, ',')
    from storage.buckets
    where id = 'apk-drafts'
  ),
  'false:524288000:application/vnd.android.package-archive,application/octet-stream',
  'apk drafts are private and limited to 500 MiB with the approved MIME types'
);

select is(
  (
    select count(*)::integer
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polroles && array['anon'::regrole, 'authenticated'::regrole]::oid[]
      and (
        coalesce(pg_get_expr(polqual, polrelid), '') like '%apk-drafts%'
        or coalesce(pg_get_expr(polwithcheck, polrelid), '') like '%apk-drafts%'
      )
  ),
  0,
  'no anon or authenticated Storage policy grants access to draft APKs'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a3000000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('apk-drafts', 'uploads/unauthorized/app.apk')$$,
  '42501',
  null,
  'authenticated clients cannot upload directly to draft APK storage'
);

select is_empty(
  $$select name from storage.objects where bucket_id = 'apk-drafts'$$,
  'authenticated clients cannot list draft APK objects'
);

reset role;
select * from finish();
rollback;
