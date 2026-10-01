import { useQuery } from '@tanstack/react-query';

import { getSupabaseClient } from '../../lib/supabase';
import { createCatalogRepository, normalizeCatalogFilters } from './catalog.repository';
import type { CatalogFilters } from './catalog.types';

export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
  apps: (filters: CatalogFilters) =>
    [...catalogKeys.all, 'apps', normalizeCatalogFilters(filters)] as const,
  app: (slug: string) => [...catalogKeys.all, 'app', slug.trim()] as const,
};

function repository() {
  return createCatalogRepository(getSupabaseClient());
}

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: () => repository().listCategories(),
  });
}

export function useCatalogApps(filters: CatalogFilters) {
  const normalized = normalizeCatalogFilters(filters);
  return useQuery({
    queryKey: catalogKeys.apps(normalized),
    queryFn: () => repository().listApps(normalized),
  });
}

export function useCatalogApp(slug: string) {
  const normalizedSlug = slug.trim();
  return useQuery({
    queryKey: catalogKeys.app(normalizedSlug),
    queryFn: () => repository().getAppBySlug(normalizedSlug),
    enabled: normalizedSlug.length > 0,
  });
}
