begin;

select plan(26);

select has_type('public', 'profile_status', 'profile_status enum exists');
select has_type('public', 'review_moderation_status', 'review_moderation_status enum exists');
select has_type('public', 'report_reason', 'report_reason enum exists');
select has_type('public', 'report_status', 'report_status enum exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'reviews', 'reviews table exists');
select has_table('public', 'reports', 'reports table exists');
select has_view('public', 'review_rating_summaries', 'review_rating_summaries view exists');
select has_function('private', 'can_write_community', array[]::name[], 'private.can_write_community exists');

insert into public.apps (
  id,
  category_id,
  slug,
  title,
  short_description,
  description,
  status
)
values (
  '11000000-0000-4000-8000-000000000001',
  '22222222-2222-4222-8222-222222222222',
  'community-function-target',
  'Community Function Target',
  'A deterministic target for community function tests.',
  'A deterministic active app used to isolate community function test fixtures.',
  'active'
);

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
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'community-valid@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"Valid.User"}'::jsonb,
  now(),
  now()
);

select is(
  (select username::text from public.profiles where user_id = '10000000-0000-4000-8000-000000000001'),
  'Valid.User',
  'profile creation from valid signup metadata preserves username text'
);

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
values (
  '10000000-0000-4000-8000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'community-turkish@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"Çağrı_Öz"}'::jsonb,
  now(),
  now()
);

select is(
  (select username::text from public.profiles where user_id = '10000000-0000-4000-8000-000000000005'),
  'Çağrı_Öz',
  'profile creation accepts Turkish letters in username metadata'
);

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
values (
  '10000000-0000-4000-8000-000000000006',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'community-max-username@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"AbcdefghijAbcdefghijAbcdefghiğ"}'::jsonb,
  now(),
  now()
);

select is(
  char_length((select username::text from public.profiles where user_id = '10000000-0000-4000-8000-000000000006')),
  30,
  'profile creation accepts a thirty-character username boundary'
);

select throws_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '10000000-0000-4000-8000-000000000007',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'community-short-username@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"ab"}'::jsonb,
      now(),
      now()
    )
  $$,
  '23514',
  null,
  'profile creation rejects username shorter than three characters'
);

select throws_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '10000000-0000-4000-8000-000000000008',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'community-long-username@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"AbcdefghijAbcdefghijAbcdefghijX"}'::jsonb,
      now(),
      now()
    )
  $$,
  '23514',
  null,
  'profile creation rejects username longer than thirty characters'
);

select throws_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '10000000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'community-invalid@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"bad..name"}'::jsonb,
      now(),
      now()
    )
  $$,
  '23514',
  null,
  'invalid username rejection blocks signup profile creation'
);

select throws_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '10000000-0000-4000-8000-000000000003',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'community-duplicate@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"valid.user"}'::jsonb,
      now(),
      now()
    )
  $$,
  '23505',
  null,
  'duplicate username rejection is case-insensitive'
);

insert into public.reviews (id, app_id, user_id, rating, body)
values (
  '20000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  5,
  '   '
);

insert into public.reviews (id, app_id, user_id, rating, body, moderation_status)
values (
  '20000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000005',
  4,
  E'\t\n\r',
  'hidden'
), (
  '20000000-0000-4000-8000-000000000004',
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000006',
  4,
  E'\t  Useful review\n',
  'hidden'
);

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
values (
  '10000000-0000-4000-8000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'community-hidden@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"Hidden.User"}'::jsonb,
  now(),
  now()
);

insert into public.reviews (id, app_id, user_id, rating, body, moderation_status)
values (
  '20000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  1,
  'Hidden review',
  'hidden'
);

select is(
  (select body from public.reviews where id = '20000000-0000-4000-8000-000000000001'),
  null,
  'blank review body normalizes to null'
);

select is(
  (select body from public.reviews where id = '20000000-0000-4000-8000-000000000003'),
  null,
  'tab and newline-only review body normalizes to null'
);

select is(
  (select body from public.reviews where id = '20000000-0000-4000-8000-000000000004'),
  'Useful review',
  'mixed-whitespace review body is trimmed consistently'
);

select throws_ok(
  $$
    insert into public.reviews (app_id, user_id, rating, body)
    values (
      '11000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      5,
      'ok'
    )
  $$,
  '23514',
  null,
  'nonblank review body shorter than three characters is rejected'
);

insert into public.reports (id, reporter_id, app_id, reason, description)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'diger',
  '   '
);

insert into public.reports (id, reporter_id, app_id, reason, description)
values (
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001',
  'diger',
  E'\t\n\r'
), (
  '30000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000006',
  '11000000-0000-4000-8000-000000000001',
  'diger',
  E'\n  Useful report\t'
);

select is(
  (select description from public.reports where id = '30000000-0000-4000-8000-000000000001'),
  null,
  'blank report description normalizes to null'
);

select is(
  (select description from public.reports where id = '30000000-0000-4000-8000-000000000002'),
  null,
  'tab and newline-only report description normalizes to null'
);

select is(
  (select description from public.reports where id = '30000000-0000-4000-8000-000000000003'),
  'Useful report',
  'mixed-whitespace report description is trimmed consistently'
);

select throws_ok(
  $$
    insert into public.reports (reporter_id, app_id, reason, description)
    values (
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      'diger',
      'no'
    )
  $$,
  '23514',
  null,
  'nonblank report description shorter than three characters is rejected'
);

select is(
  (
    select review_count
    from public.review_rating_summaries
    where app_id = '11000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'review summary excludes hidden reviews from its count'
);

select is(
  (
    select average_rating
    from public.review_rating_summaries
    where app_id = '11000000-0000-4000-8000-000000000001'
  ),
  5.00::numeric,
  'review summary excludes hidden reviews from its average'
);

select * from finish();
rollback;
