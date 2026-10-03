begin;

select plan(12);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '90000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'avatar-active@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"avatar_active"}'::jsonb,
    now(),
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'avatar-unconfirmed@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"avatar_unconfirmed"}'::jsonb,
    now(),
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'avatar-suspended@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"avatar_suspended"}'::jsonb,
    now(),
    now()
  );

update public.profiles
set status = 'suspended'
where user_id = '90000000-0000-4000-8000-000000000003';

insert into storage.objects (bucket_id, name)
values ('avatars', '90000000-0000-4000-8000-000000000001/avatar.png');

select is(
  (
    select public::text || ':' || file_size_limit::text || ':' || array_to_string(allowed_mime_types, ',')
    from storage.buckets
    where id = 'avatars'
  ),
  'true:5242880:image/png,image/jpeg,image/webp',
  'avatars bucket is public with 5 MB PNG JPEG WebP restrictions'
);

set local role anon;

select results_eq(
  $$select name from storage.objects where bucket_id = 'avatars'$$,
  array['90000000-0000-4000-8000-000000000001/avatar.png']::text[],
  'anonymous users can publicly read avatar objects'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'anonymous/avatar.png')$$,
  '42501',
  null,
  'anonymous users cannot write avatar objects'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"90000000-0000-4000-8000-000000000001"}', true);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values ('avatars', '90000000-0000-4000-8000-000000000001/avatar.webp')
  $$,
  'confirmed active user can insert avatar in own prefix'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values ('avatars', '90000000-0000-4000-8000-000000000001/not-avatar.webp')
  $$,
  '42501',
  null,
  'confirmed active user can write only the canonical avatar filename in own prefix'
);

select results_eq(
  $$select name from storage.objects where bucket_id = 'avatars' and name like '90000000-0000-4000-8000-000000000001/%' order by name$$,
  array[
    '90000000-0000-4000-8000-000000000001/avatar.png',
    '90000000-0000-4000-8000-000000000001/avatar.webp'
  ]::text[],
  'confirmed active user can select own avatar prefix for upsert'
);

select lives_ok(
  $$
    update storage.objects
    set metadata = '{"updated": true}'::jsonb
    where bucket_id = 'avatars'
      and name = '90000000-0000-4000-8000-000000000001/avatar.webp'
  $$,
  'confirmed active user can update own avatar prefix for upsert'
);

select throws_ok(
  $$
    update storage.objects
    set name = '90000000-0000-4000-8000-000000000099/avatar.webp'
    where bucket_id = 'avatars'
      and name = '90000000-0000-4000-8000-000000000001/avatar.webp'
  $$,
  '42501',
  null,
  'confirmed active user cannot move avatar outside own prefix'
);

select ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'avatars_owner_delete'
      and polcmd = 'd'
      and polroles = array['authenticated'::regrole]::oid[]
  ),
  'confirmed active user has an own-prefix avatar delete policy for Storage API deletes'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"90000000-0000-4000-8000-000000000002"}', true);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values ('avatars', '90000000-0000-4000-8000-000000000002/avatar.png')
  $$,
  '42501',
  null,
  'unconfirmed users cannot write avatar objects'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"90000000-0000-4000-8000-000000000003"}', true);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values ('avatars', '90000000-0000-4000-8000-000000000003/avatar.png')
  $$,
  '42501',
  null,
  'suspended users cannot write avatar objects'
);

reset role;

select ok(
  has_table_privilege('anon', 'storage.objects', 'SELECT')
  and has_table_privilege('authenticated', 'storage.objects', 'INSERT')
  and has_table_privilege('authenticated', 'storage.objects', 'UPDATE')
  and has_table_privilege('authenticated', 'storage.objects', 'DELETE'),
  'storage grants allow public read and authenticated own-prefix writes'
);

select * from finish();
rollback;
