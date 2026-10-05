begin;

select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin-panel-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"admin_panel_a"}'::jsonb, now(), now()
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin-panel-user@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"admin_panel_user"}'::jsonb, now(), now()
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin-panel-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"admin_panel_b"}'::jsonb, now(), now()
  );

insert into public.user_roles (user_id, role)
values
  ('a1000000-0000-4000-8000-000000000001', 'admin'),
  ('a1000000-0000-4000-8000-000000000003', 'admin');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select role::text from public.user_roles where user_id = auth.uid()$$,
  array['admin']::text[],
  'authenticated admin can read their own role'
);

select results_eq(
  $$select user_id from public.user_roles order by user_id$$,
  array['a1000000-0000-4000-8000-000000000001'::uuid],
  'authenticated admin cannot read another admin role'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000002"}',
  true
);

select is_empty(
  $$select role from public.user_roles$$,
  'non-admin self-role read returns no admin row'
);

select throws_ok(
  $$delete from public.admin_audit_logs$$,
  '42501',
  null,
  'authenticated clients cannot delete audit logs'
);

select throws_ok(
  $$update public.admin_audit_logs set metadata = '{}'::jsonb$$,
  '42501',
  null,
  'authenticated clients cannot update audit logs'
);

reset role;

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_set_review_status(uuid,uuid,public.review_moderation_status)',
    'EXECUTE'
  ),
  'anonymous role cannot execute admin transition RPCs'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_set_review_status(uuid,uuid,public.review_moderation_status)',
    'EXECUTE'
  ),
  'authenticated role cannot execute admin transition RPCs'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_set_review_status(uuid,uuid,public.review_moderation_status)',
    'EXECUTE'
  ),
  'service role can execute admin transition RPCs'
);

set local role service_role;

select throws_ok(
  $$select public.admin_set_profile_status(
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000003',
    'suspended'
  )$$,
  'P0001',
  'Yönetici hesabı askıya alınamaz.',
  'an admin target cannot be suspended even through a direct RPC call'
);

select ok(
  has_table_privilege('service_role', 'public.admin_audit_logs', 'SELECT')
  and has_table_privilege('service_role', 'public.admin_audit_logs', 'INSERT')
  and not has_table_privilege('service_role', 'public.admin_audit_logs', 'UPDATE')
  and not has_table_privilege('service_role', 'public.admin_audit_logs', 'DELETE'),
  'service role can append and read but cannot rewrite audit logs'
);

reset role;
select * from finish();
rollback;
