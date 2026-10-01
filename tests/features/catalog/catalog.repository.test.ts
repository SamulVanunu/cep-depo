import { createCatalogRepository } from '../../../src/features/catalog/catalog.repository';
import { catalogKeys } from '../../../src/features/catalog/catalog.queries';
import type { CatalogAppRow, CatalogCardRow } from '../../../src/features/catalog/catalog.mapper';

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
  icon_path: null,
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

function createDetailQuery(result: { data: CatalogAppRow | null; error: unknown }) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    maybeSingle: jest.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue(result);
  return query;
}

describe('catalog repository', () => {
  it('builds stable keys from normalized catalog filters', () => {
    expect(
      catalogKeys.apps({ query: '  IPTV ', categorySlug: ' eglence ', sort: 'newest' }),
    ).toEqual(['catalog', 'apps', { query: 'IPTV', categorySlug: 'eglence', sort: 'newest' }]);
  });

  it('normalizes blank filters and delegates sorting to search_catalog', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [cardRow], error: null });
    const repository = createCatalogRepository({ rpc, from: jest.fn() } as never);

    const result = await repository.listApps({
      query: '   ',
      categorySlug: null,
      sort: 'popular',
    });

    expect(rpc).toHaveBeenCalledWith('search_catalog', {
      p_query: '',
      p_category_slug: null,
      p_sort: 'popular',
    });
    expect(result.map(app => app.slug)).toEqual(['cep-iptv']);
  });

  it('returns null for a genuine no-row detail result', async () => {
    const query = createDetailQuery({ data: null, error: null });
    const repository = createCatalogRepository({
      rpc: jest.fn(),
      from: jest.fn().mockReturnValue(query),
    } as never);

    await expect(repository.getAppBySlug('missing')).resolves.toBeNull();
    expect(query.order).toHaveBeenNthCalledWith(1, 'version_code', {
      ascending: false,
      referencedTable: 'versions',
    });
    expect(query.order).toHaveBeenNthCalledWith(2, 'position', {
      ascending: true,
      referencedTable: 'screenshots',
    });
  });

  it('returns null for PostgREST no-row errors and throws other failures', async () => {
    const noRowQuery = createDetailQuery({
      data: null,
      error: { code: 'PGRST116', message: '0 rows' },
    });
    const failedQuery = createDetailQuery({
      data: null,
      error: { code: 'XX000', message: 'catalog unavailable' },
    });

    const notFoundRepository = createCatalogRepository({
      rpc: jest.fn(),
      from: jest.fn().mockReturnValue(noRowQuery),
    } as never);
    const failingRepository = createCatalogRepository({
      rpc: jest.fn(),
      from: jest.fn().mockReturnValue(failedQuery),
    } as never);

    await expect(notFoundRepository.getAppBySlug('missing')).resolves.toBeNull();
    await expect(failingRepository.getAppBySlug('broken')).rejects.toThrow(
      'catalog unavailable',
    );
  });
});
