import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';
import { mapCatalogApp, mapCatalogCard, type CatalogAppRow } from './catalog.mapper';
import type { CatalogApp, CatalogCard, CatalogFilters, Category } from './catalog.types';

type CatalogClient = SupabaseClient<Database>;

type DataError = {
  code?: string;
  message?: string;
};

export type CatalogRepository = {
  listCategories(): Promise<readonly Category[]>;
  listApps(filters: CatalogFilters): Promise<readonly CatalogCard[]>;
  getAppBySlug(slug: string): Promise<CatalogApp | null>;
  recordDownload(versionId: string, installationId: string): Promise<boolean>;
};

export function normalizeCatalogFilters(filters: CatalogFilters): CatalogFilters {
  const query = filters.query.trim();
  const categorySlug = filters.categorySlug?.trim() || null;
  return Object.freeze({ query, categorySlug, sort: filters.sort });
}

function errorFrom(error: DataError): Error {
  return new Error(error.message || 'Katalog isteği tamamlanamadı.');
}

export function createCatalogRepository(client: CatalogClient): CatalogRepository {
  return {
    async listCategories() {
      const { data, error } = await client
        .from('categories')
        .select('id, slug, name')
        .order('position', { ascending: true });

      if (error) throw errorFrom(error);

      return Object.freeze(
        (data ?? []).map(category =>
          Object.freeze({ id: category.id, slug: category.slug, name: category.name }),
        ),
      );
    },

    async listApps(filters) {
      const normalized = normalizeCatalogFilters(filters);
      const { data, error } = await client.rpc('search_catalog', {
        p_query: normalized.query,
        p_category_slug: normalized.categorySlug,
        p_sort: normalized.sort,
      } as Database['public']['Functions']['search_catalog']['Args']);

      if (error) throw errorFrom(error);
      return Object.freeze((data ?? []).map(mapCatalogCard));
    },

    async getAppBySlug(slug) {
      const normalizedSlug = slug.trim();
      if (!normalizedSlug) return null;

      const { data, error } = await client
        .from('apps')
        .select(
          `
            id,
            slug,
            title,
            short_description,
            description,
            icon_path,
            featured,
            download_count,
            category:categories!apps_category_id_fkey(id, slug, name),
            versions:app_versions(
              id, version_name, version_code, changelog, apk_path,
              apk_size_bytes, sha256, published_at
            ),
            screenshots:app_screenshots(id, path, alt_text, position)
          `,
        )
        .eq('slug', normalizedSlug)
        .eq('status', 'active')
        .order('version_code', { ascending: false, referencedTable: 'app_versions' })
        .order('position', { ascending: true, referencedTable: 'app_screenshots' })
        .maybeSingle();

      if (error?.code === 'PGRST116') return null;
      if (error) throw errorFrom(error);
      if (!data) return null;

      return mapCatalogApp(data as unknown as CatalogAppRow);
    },

    async recordDownload(versionId, installationId) {
      const { data, error } = await client.rpc('record_download', {
        p_version_id: versionId,
        p_installation_id: installationId,
      });

      if (error) throw errorFrom(error);
      if (typeof data !== 'boolean') {
        throw new Error('İndirme kaydı doğrulanamadı.');
      }
      return data;
    },
  };
}
