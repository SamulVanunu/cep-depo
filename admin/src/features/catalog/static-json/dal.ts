import 'server-only';

import type { AdminIdentity } from '../../../server/auth/require-admin';
import { ActionException } from '../../../server/errors/action-error';
import { getAdminClient } from '../../../server/supabase/admin-client';
import { buildStaticCatalog } from './build';
import type {
  StaticCatalogBundle,
  StaticCatalogSourceApp,
  StaticCatalogSourceCategory,
} from './types';

export type StaticCatalogSource = Readonly<{
  apps: readonly StaticCatalogSourceApp[];
  categories: readonly StaticCatalogSourceCategory[];
}>;

/**
 * Reads every row the static documents need in one pass. All apps are fetched,
 * not only active ones, so the builder can name an unpublished app in the skip
 * report instead of letting it disappear from the export without a trace. The
 * builder still validates status/category/version, so an inactive or stale app
 * can never leak into the published JSON.
 */
export async function loadStaticCatalogSource(
  identity: AdminIdentity,
): Promise<StaticCatalogSource> {
  const client = getAdminClient(identity);

  const [categories, apps] = await Promise.all([
    client
      .from('categories')
      .select('id, slug, name, position, is_active')
      .order('position')
      .order('name'),
    client
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
          status,
          category:categories!apps_category_id_fkey(id, slug, name, position, is_active),
          versions:app_versions(
            id, version_name, version_code, changelog, download_source, apk_path,
            apk_url, apk_size_bytes, sha256, published_at, supports_mobile,
            supports_tv, account_requirement, status
          ),
          screenshots:app_screenshots(id, path, alt_text, position)
        `,
      )
      .order('title'),
  ]);

  if (categories.error || apps.error) throw new ActionException('TEMPORARY');

  return Object.freeze({
    categories: Object.freeze((categories.data ?? []) as unknown as StaticCatalogSourceCategory[]),
    apps: Object.freeze((apps.data ?? []) as unknown as StaticCatalogSourceApp[]),
  });
}

export async function buildStaticCatalogForAdmin(
  identity: AdminIdentity,
  generatedAt: string = new Date().toISOString(),
): Promise<StaticCatalogBundle> {
  const source = await loadStaticCatalogSource(identity);
  return buildStaticCatalog(source.apps, source.categories, { generatedAt });
}
