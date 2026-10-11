import { describe, expect, it } from 'vitest';

import { parseListParams } from './search-params';

describe('parseListParams', () => {
  it.each(['%', '_', 'x'.repeat(201)])('drops unsafe search input: %s', query => {
    expect(parseListParams({ query }).query).toBeUndefined();
  });

  it('drops invalid UUID filters', () => {
    expect(parseListParams({ categoryId: 'not-a-uuid' }).categoryId).toBeUndefined();
  });

  it('allows fixed sort/status values and clamps pagination', () => {
    expect(
      parseListParams({
        page: '3',
        pageSize: '500',
        query: '  Güvenli uygulama  ',
        sort: 'title',
        direction: 'asc',
        status: 'archived',
        categoryId: 'a1000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      page: 3,
      pageSize: 100,
      query: 'Güvenli uygulama',
      sort: 'title',
      direction: 'asc',
      status: 'archived',
      categoryId: 'a1000000-0000-4000-8000-000000000001',
    });
  });

  it('uses safe defaults for unknown sort and pagination values', () => {
    expect(parseListParams({ page: '-4', pageSize: 'oops', sort: 'download_count' })).toEqual({
      page: 1,
      pageSize: 25,
      sort: 'updated_at',
      direction: 'desc',
    });
  });
});
