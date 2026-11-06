begin;

select plan(6);

-- P0-2: the legacy publication functions must not exist at all. Checking
-- `to_regprocedure` catches a re-created overload under either name, which a
-- privilege check alone would miss.
select is(
  to_regprocedure('public.admin_publish_version(uuid,uuid)'),
  null::regprocedure,
  'the legacy publication RPC is gone'
);

select is(
  to_regprocedure('public.admin_publish_version_and_activate_app(uuid,uuid)'),
  null::regprocedure,
  'the legacy atomic activation RPC is gone'
);

-- Exactly one public function may write the published state. This is the
-- invariant that stops a future helper from becoming a second publication path.
select is(
  (
    select count(*)::integer
    from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.prosrc ~ 'set[[:space:]]+status[[:space:]]*=[[:space:]]*''published'''
  ),
  1,
  'exactly one public function can mark a version published'
);

select is(
  (
    select proc.proname
    from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.prosrc ~ 'set[[:space:]]+status[[:space:]]*=[[:space:]]*''published'''
  ),
  'admin_publish_version_replacing_previous'::name,
  'the replacement RPC is the only publication path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_publish_version_replacing_previous(uuid,uuid)',
    'EXECUTE'
  ),
  'the service role can execute the replacement publication'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_publish_version_replacing_previous(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admin_publish_version_replacing_previous(uuid,uuid)',
    'EXECUTE'
  ),
  'clients cannot execute the replacement publication'
);

select * from finish();
rollback;
