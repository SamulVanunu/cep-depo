begin;

select plan(10);

select results_eq(
  $$
    select version_code
    from public.catalog_app_cards
    where slug = 'cep-iptv'
  $$,
  array[12]::integer[],
  'catalog cards expose only the highest published version'
);

select results_eq(
  $$select title from public.search_catalog('IPTV', null, 'popular')$$,
  array['Cep İptv']::text[],
  'search is Turkish-case tolerant'
);

select results_eq(
  $$select title from public.search_catalog('eglence', 'eglence', 'newest')$$,
  array['Radyo Cep', 'Cep İptv']::text[],
  'search is diacritic tolerant and newest ordering is stable'
);

select throws_ok(
  $$select * from public.search_catalog('', null, 'unsupported')$$,
  '22023',
  'Desteklenmeyen katalog sıralaması: unsupported',
  'search rejects unknown sort values'
);

select throws_ok(
  $$select public.record_download('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$,
  'P0001',
  'Yayımlanmış sürüm bulunamadı.',
  'record_download rejects nonexistent versions'
);

select throws_ok(
  $$select public.record_download('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$,
  'P0001',
  'Yayımlanmış sürüm bulunamadı.',
  'record_download rejects draft versions'
);

select is(
  public.record_download(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  true,
  'first installation/version event is counted'
);

select is(
  public.record_download(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  false,
  'duplicate installation/version event is ignored'
);

select is(
  (select download_count from public.apps where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  6::bigint,
  'duplicate event increments the app count once'
);

select is(
  public.record_download(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
  ),
  true,
  'a new installation UUID is counted'
);

select * from finish();
rollback;
