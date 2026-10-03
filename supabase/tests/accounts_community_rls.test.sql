begin;

select plan(21);

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
    '40000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'community-active-a@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"active_a"}'::jsonb,
    now(),
    now()
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'community-active-b@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"active_b"}'::jsonb,
    now(),
    now()
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'community-unconfirmed@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"unconfirmed_user"}'::jsonb,
    now(),
    now()
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'community-suspended@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"suspended_user"}'::jsonb,
    now(),
    now()
  );

update public.profiles
set status = 'suspended'
where user_id = '40000000-0000-4000-8000-000000000004';

insert into public.apps (
  id,
  category_id,
  slug,
  title,
  short_description,
  description,
  status
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'community-target',
    'Community Target',
    'A deterministic community target app.',
    'A deterministic community target app used by RLS tests.',
    'active'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '22222222-2222-4222-8222-222222222222',
    'community-archived',
    'Community Archived',
    'A deterministic archived target app.',
    'A deterministic archived target app used by RLS tests.',
    'archived'
  );

insert into public.app_versions (
  id,
  app_id,
  version_name,
  version_code,
  apk_path,
  apk_size_bytes,
  sha256,
  status,
  published_at
)
values
  (
    '60000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '1.0',
    1,
    'apps/50000000-0000-4000-8000-000000000001/versions/60000000-0000-4000-8000-000000000001.apk',
    12345,
    repeat('1', 64),
    'published',
    now()
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    '1.1-draft',
    2,
    'apps/50000000-0000-4000-8000-000000000001/versions/60000000-0000-4000-8000-000000000002.apk',
    12346,
    repeat('2', 64),
    'draft',
    null
  );

insert into public.reviews (id, app_id, user_id, rating, body, moderation_status)
values (
  '70000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  4,
  'Visible review',
  'visible'
), (
  '70000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000003',
  1,
  'Hidden review',
  'hidden'
);

set local role anon;

select results_eq(
  $$select body from public.reviews where app_id = '50000000-0000-4000-8000-000000000001' order by body$$,
  array['Visible review']::text[],
  'anonymous public reads include visible reviews only'
);

select throws_ok(
  $$
    insert into public.reviews (app_id, user_id, rating)
    values ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 5)
  $$,
  '42501',
  null,
  'anonymous review write is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000001"}', true);

select lives_ok(
  $$
    insert into public.reviews (app_id, user_id, rating, body)
    values (
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      5,
      'Great app'
    )
  $$,
  'confirmed active user can insert own review'
);

select lives_ok(
  $$
    update public.reviews
    set rating = 3, body = 'Updated review'
    where app_id = '50000000-0000-4000-8000-000000000001'
      and user_id = '40000000-0000-4000-8000-000000000001'
  $$,
  'confirmed active user can update own review content'
);

select throws_ok(
  $$
    update public.reviews
    set moderation_status = 'hidden'
    where app_id = '50000000-0000-4000-8000-000000000001'
      and user_id = '40000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'review owner cannot escalate moderation fields'
);

select throws_ok(
  $$
    insert into public.reviews (app_id, user_id, rating)
    values ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 4)
  $$,
  '23505',
  null,
  'one review per app per user is enforced'
);

select throws_ok(
  $$
    insert into public.reviews (app_id, user_id, rating)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '40000000-0000-4000-8000-000000000001', 6)
  $$,
  '23514',
  null,
  'review rating constraints reject values outside one through five'
);

select lives_ok(
  $$
    insert into public.reports (reporter_id, app_id, reason, description)
    values (
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      'diger',
      'Manual report'
    )
  $$,
  'confirmed active user can insert own app report'
);

select results_eq(
  $$
    select reason::text
    from public.reports
    where reporter_id = '40000000-0000-4000-8000-000000000001'
      and app_id = '50000000-0000-4000-8000-000000000001'
      and version_id is null
  $$,
  array['diger']::text[],
  'reporter can read own report'
);

select throws_ok(
  $$
    insert into public.reports (reporter_id, app_id, reason)
    values ('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'link_bozuk')
  $$,
  '23505',
  null,
  'one open app-only report per target is enforced'
);

select throws_ok(
  $$
    insert into public.reports (reporter_id, app_id, version_id, reason)
    values (
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'link_bozuk'
    )
  $$,
  '42501',
  null,
  'reports can target only published versions'
);

select throws_ok(
  $$
    insert into public.reports (reporter_id, app_id, reason)
    values ('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'diger')
  $$,
  '42501',
  null,
  'reports can target only active apps'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000002"}', true);

update public.reviews
set rating = 2
where app_id = '50000000-0000-4000-8000-000000000001'
  and user_id = '40000000-0000-4000-8000-000000000001';

select is(
  (
    select rating::integer
    from public.reviews
    where app_id = '50000000-0000-4000-8000-000000000001'
      and user_id = '40000000-0000-4000-8000-000000000001'
  ),
  3,
  'cross-user review update is rejected by RLS'
);

select is_empty(
  $$
    select id
    from public.reports
    where reporter_id = '40000000-0000-4000-8000-000000000001'
      and app_id = '50000000-0000-4000-8000-000000000001'
      and version_id is null
  $$,
  'cross-user report read is rejected by RLS'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000001"}', true);

select lives_ok(
  $$
    delete from public.reviews
    where app_id = '50000000-0000-4000-8000-000000000001'
      and user_id = '40000000-0000-4000-8000-000000000001'
  $$,
  'confirmed active user can delete own review'
);

select is_empty(
  $$
    select id
    from public.reviews
    where app_id = '50000000-0000-4000-8000-000000000001'
      and user_id = '40000000-0000-4000-8000-000000000001'
  $$,
  'own review delete removes the row'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000003"}', true);

select throws_ok(
  $$
    insert into public.reviews (app_id, user_id, rating)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '40000000-0000-4000-8000-000000000003', 5)
  $$,
  '42501',
  null,
  'unconfirmed users cannot write community content'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000004"}', true);

select throws_ok(
  $$
    insert into public.reviews (app_id, user_id, rating)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '40000000-0000-4000-8000-000000000004', 5)
  $$,
  '42501',
  null,
  'suspended users cannot write community content'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    update public.reviews
    set moderation_status = 'hidden'
    where id = '70000000-0000-4000-8000-000000000001'
  $$,
  'service role can manage moderation fields'
);

reset role;

select throws_ok(
  $$
    insert into public.reports (reporter_id, app_id, version_id, reason)
    values (
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000001',
      'diger'
    )
  $$,
  '23503',
  null,
  'composite foreign key enforces app/version pairing'
);

select ok(
  has_table_privilege('authenticated', 'public.reviews', 'SELECT')
  and has_column_privilege('authenticated', 'public.reviews', 'app_id', 'INSERT')
  and has_column_privilege('authenticated', 'public.reviews', 'user_id', 'INSERT')
  and has_column_privilege('authenticated', 'public.reviews', 'rating', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.reviews', 'id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.reviews', 'moderation_status', 'UPDATE')
  and has_column_privilege('authenticated', 'public.reports', 'reporter_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.reports', 'status', 'INSERT')
  and not has_table_privilege('anon', 'public.reviews', 'INSERT'),
  'explicit community grants expose reads and own writes only'
);

select * from finish();
rollback;
