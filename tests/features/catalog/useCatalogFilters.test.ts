import { act, renderHook } from '@testing-library/react-native';

import { useCatalogFilters } from '../../../src/features/catalog/useCatalogFilters';

describe('useCatalogFilters', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('debounces search by 250 ms and preserves Turkish text', () => {
    const { result } = renderHook(() => useCatalogFilters());

    act(() => result.current.setQuery('İpTv'));
    act(() => jest.advanceTimersByTime(249));
    expect(result.current.debouncedQuery).toBe('');

    act(() => jest.advanceTimersByTime(1));
    expect(result.current.debouncedQuery).toBe('İpTv');
  });

  it('exposes category and sort selections without coupling them', () => {
    const { result } = renderHook(() => useCatalogFilters());

    act(() => {
      result.current.setCategorySlug('eglence');
      result.current.setSort('newest');
    });

    expect(result.current.categorySlug).toBe('eglence');
    expect(result.current.sort).toBe('newest');
    expect(result.current.query).toBe('');
  });
});
