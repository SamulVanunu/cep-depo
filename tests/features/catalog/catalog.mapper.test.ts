import {
  mapCatalogApp,
  mapCatalogCard,
  type CatalogAppRow,
  type CatalogCardRow,
} from '../../../src/features/catalog/catalog.mapper';

const cardRow: CatalogCardRow = {
  apk_path:
    'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.apk',
  apk_size_bytes: 24_000_000,
  app_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  category_id: '22222222-2222-4222-8222-222222222222',
  category_name: 'Eğlence',
  category_slug: 'eglence',
  download_count: 5,
  featured: true,
  icon_path: 'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/icon.png',
  published_at: '2026-09-28T10:00:00Z',
  sha256: 'b'.repeat(64),
  short_description: 'Canlı yayın listelerini sade bir arayüzde aç.',
  slug: 'cep-iptv',
  title: 'Cep İptv',
  version_changelog: 'Açılış performansı ve oynatma düzeltmeleri.',
  version_code: 12,
  version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  version_name: '1.2',
};

describe('catalog mapper', () => {
  it('maps snake_case card rows to immutable CatalogCard values', () => {
    const result = mapCatalogCard(cardRow);

    expect(result).toMatchObject({
      slug: 'cep-iptv',
      category: { slug: 'eglence', name: 'Eğlence' },
      currentVersion: { code: 12, name: '1.2' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.category)).toBe(true);
    expect(Object.isFrozen(result.currentVersion)).toBe(true);
  });

  it('rejects nullable view rows that do not contain a public version', () => {
    expect(() => mapCatalogCard({ ...cardRow, version_id: null })).toThrow(
      'Katalog verisi eksik veya geçersiz.',
    );
  });

  it('maps detail versions and screenshots in repository order', () => {
    const detailRow: CatalogAppRow = {
      id: cardRow.app_id!,
      slug: cardRow.slug!,
      title: cardRow.title!,
      short_description: cardRow.short_description!,
      description: 'Uygulamanın uzun açıklaması burada yer alır.',
      icon_path: cardRow.icon_path,
      featured: true,
      download_count: 5,
      category: {
        id: cardRow.category_id!,
        slug: cardRow.category_slug!,
        name: cardRow.category_name!,
      },
      versions: [
        {
          id: cardRow.version_id!,
          version_name: cardRow.version_name!,
          version_code: cardRow.version_code!,
          changelog: cardRow.version_changelog!,
          apk_path: cardRow.apk_path!,
          apk_size_bytes: cardRow.apk_size_bytes!,
          sha256: cardRow.sha256!,
          published_at: cardRow.published_at!,
        },
      ],
      screenshots: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
          path: 'apps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/screenshots/01.webp',
          alt_text: 'Cep İptv ana ekranı',
          position: 0,
        },
      ],
    };

    const result = mapCatalogApp(detailRow);

    expect(result.currentVersion.code).toBe(12);
    expect(result.versions.map(version => version.code)).toEqual([12]);
    expect(result.screenshots.map(screenshot => screenshot.position)).toEqual([0]);
    expect(Object.isFrozen(result.versions)).toBe(true);
    expect(Object.isFrozen(result.screenshots)).toBe(true);
  });
});
