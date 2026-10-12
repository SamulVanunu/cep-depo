begin;

select plan(5);

select is(
  (select count(*)::integer from public.categories where is_default),
  1,
  'exactly one category is the default'
);

select results_eq(
  $$select slug::text, is_active from public.categories where is_default$$,
  $$values ('genel'::text, true)$$,
  'the default category is the active Genel category'
);

select throws_ok(
  $$insert into public.categories (name, slug, is_default) values ('Başka Varsayılan', 'baska-varsayilan', true)$$,
  '23505',
  null,
  'a second default category is rejected'
);

select throws_ok(
  $$update public.categories set is_active = false where is_default$$,
  '23514',
  null,
  'the default category cannot be deactivated'
);

select results_eq(
  $$select id, category_id
    from public.apps
    where id in (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
    )
    order by id$$,
  $$values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '22222222-2222-4222-8222-222222222222'::uuid),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid, '22222222-2222-4222-8222-222222222222'::uuid),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid, '11111111-1111-4111-8111-111111111111'::uuid)$$,
  'adding the default category preserves existing app category assignments'
);

select * from finish();
rollback;
