import { useEffect, useState } from 'react';

import type { CatalogFilters } from './catalog.types';

export function useCatalogFilters() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [sort, setSort] = useState<CatalogFilters['sort']>('popular');
  const [platform, setPlatform] = useState<CatalogFilters['platform']>('all');

  useEffect(() => {
    if (query === debouncedQuery) return;
    const timeout = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timeout);
  }, [debouncedQuery, query]);

  return {
    query,
    setQuery,
    debouncedQuery,
    categorySlug,
    setCategorySlug,
    sort,
    setSort,
    platform,
    setPlatform,
  } as const;
}
