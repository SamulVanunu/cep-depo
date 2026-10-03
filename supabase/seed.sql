insert into public.categories (id, name, slug, position)
values
  ('11111111-1111-4111-8111-111111111111', 'Araçlar', 'araclar', 10),
  ('22222222-2222-4222-8222-222222222222', 'Eğlence', 'eglence', 20),
  ('33333333-3333-4333-8333-333333333333', 'IPTV', 'iptv', 30);

insert into public.apps (
  id,
  category_id,
  slug,
  title,
  short_description,
  description,
  icon_path,
  status,
  featured,
  download_count,
  created_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '22222222-2222-4222-8222-222222222222',
    'cep-iptv',
    'Cep İptv',
    'Canlı yayın listelerini sade bir arayüzde aç.',
    'Canlı yayın listelerini hızlı, sade ve koyu temalı bir arayüzde görüntüle.',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/icon.png',
    'active',
    true,
    5,
    '2026-09-01T10:00:00Z'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '22222222-2222-4222-8222-222222222222',
    'radyo-cep',
    'Radyo Cep',
    'Yerel ve ulusal radyo istasyonlarını dinle.',
    'Sevdiğin radyo istasyonlarına hızlı eriş ve favorilerini tek yerde tut.',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/icon.png',
    'active',
    false,
    10,
    '2026-09-02T10:00:00Z'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '11111111-1111-4111-8111-111111111111',
    'eski-arac',
    'Eski Araç',
    'Artık mağazada gösterilmeyen eski uygulama.',
    'Arşivlenmiş kayıtların public katalogdan gizlendiğini doğrulamak için kullanılır.',
    null,
    'archived',
    false,
    0,
    '2026-08-01T10:00:00Z'
  );

insert into public.app_versions (
  id,
  app_id,
  version_name,
  version_code,
  changelog,
  apk_path,
  apk_size_bytes,
  sha256,
  status,
  published_at
)
values
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '1.0',
    10,
    'İlk kararlı sürüm.',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.apk',
    20000000,
    repeat('a', 64),
    'published',
    '2026-09-20T10:00:00Z'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '1.2',
    12,
    'Açılış performansı ve oynatma düzeltmeleri.',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.apk',
    24000000,
    repeat('b', 64),
    'published',
    '2026-09-28T10:00:00Z'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '1.3-beta',
    13,
    'Henüz yayımlanmamış test sürümü.',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3.apk',
    25000000,
    repeat('c', 64),
    'draft',
    null
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '2.0',
    20,
    'Yeni istasyon listesi.',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4.apk',
    31000000,
    repeat('d', 64),
    'published',
    '2026-09-30T10:00:00Z'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '1.0',
    1,
    'Arşivlenmiş uygulama sürümü.',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5.apk',
    10000000,
    repeat('e', 64),
    'published',
    '2026-08-02T10:00:00Z'
  );

insert into public.app_screenshots (id, app_id, path, alt_text, position)
values
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/screenshots/01.webp',
    'Cep İptv ana ekranı',
    0
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/screenshots/02.webp',
    'Cep İptv oynatıcı ekranı',
    1
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/screenshots/01.webp',
    'Radyo Cep istasyon listesi',
    0
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
values
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'community-demo-a@example.test',
    '',
    '2026-10-01T10:00:00Z',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"demo_user_a"}'::jsonb,
    '2026-10-01T10:00:00Z',
    '2026-10-01T10:00:00Z'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'community-demo-b@example.test',
    '',
    '2026-10-01T10:05:00Z',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"demo_user_b"}'::jsonb,
    '2026-10-01T10:05:00Z',
    '2026-10-01T10:05:00Z'
  );

insert into public.reviews (id, app_id, user_id, rating, body, created_at, updated_at)
values
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    5,
    'Kurulumu kolay ve yayın listesi hızlı açılıyor.',
    '2026-10-01T10:10:00Z',
    '2026-10-01T10:10:00Z'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
    4,
    'İstasyon listesi sade ve kullanışlı.',
    '2026-10-01T10:15:00Z',
    '2026-10-01T10:15:00Z'
  );
