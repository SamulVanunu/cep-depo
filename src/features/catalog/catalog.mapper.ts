import type { Database } from '../../types/database.types';
import type {
  ApkSource,
  CatalogApp,
  CatalogCard,
  CatalogScreenshot,
  CatalogVersion,
  Category,
} from './catalog.types';

export type CatalogCardRow = Database['public']['Views']['catalog_app_cards']['Row'];

export type CatalogAppRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  icon_path: string | null;
  featured: boolean;
  download_count: number;
  category: { id: string; slug: string; name: string };
  versions: {
    id: string;
    version_name: string;
    version_code: number;
    changelog: string;
    download_source: 'storage' | 'external';
    apk_path: string | null;
    apk_url: string | null;
    apk_size_bytes: number;
    sha256: string;
    published_at: string;
  }[];
  screenshots: {
    id: string;
    path: string;
    alt_text: string;
    position: number;
  }[];
};

const INVALID_CATALOG_DATA = 'Katalog verisi eksik veya geçersiz.';

function requiredString(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(INVALID_CATALOG_DATA);
  }
  return value;
}

function nonNegativeNumber(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(INVALID_CATALOG_DATA);
  }
  return value;
}

function positiveInteger(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(INVALID_CATALOG_DATA);
  }
  return value;
}

function mapCategory(row: { id: string; slug: string; name: string }): Category {
  return Object.freeze({
    id: requiredString(row.id),
    slug: requiredString(row.slug),
    name: requiredString(row.name),
  });
}

function mapVersion(row: {
  id: string | null;
  version_name: string | null;
  version_code: number | null;
  changelog: string | null;
  apk_path: string | null;
  apk_url: string | null;
  download_source: 'storage' | 'external' | null;
  apk_size_bytes: number | null;
  sha256: string | null;
  published_at: string | null;
}): CatalogVersion {
  let apkSource: ApkSource;
  if (row.download_source === 'storage' && row.apk_path && row.apk_url === null) {
    apkSource = Object.freeze({ kind: 'storage', path: requiredString(row.apk_path) });
  } else if (row.download_source === 'external' && row.apk_path === null && row.apk_url) {
    apkSource = Object.freeze({ kind: 'external', url: requiredString(row.apk_url) });
  } else {
    throw new Error(INVALID_CATALOG_DATA);
  }
  return Object.freeze({
    id: requiredString(row.id),
    name: requiredString(row.version_name),
    code: positiveInteger(row.version_code),
    changelog: row.changelog ?? '',
    apkSource,
    apkSizeBytes: positiveInteger(row.apk_size_bytes),
    sha256: requiredString(row.sha256),
    publishedAt: requiredString(row.published_at),
  });
}

export function mapCatalogCard(row: CatalogCardRow): CatalogCard {
  const category = mapCategory({
    id: requiredString(row.category_id),
    slug: requiredString(row.category_slug),
    name: requiredString(row.category_name),
  });
  const currentVersion = mapVersion({
    id: row.version_id,
    version_name: row.version_name,
    version_code: row.version_code,
    changelog: row.version_changelog,
    apk_path: row.apk_path,
    apk_url: row.apk_url,
    download_source: row.download_source,
    apk_size_bytes: row.apk_size_bytes,
    sha256: row.sha256,
    published_at: row.published_at,
  });

  if (typeof row.featured !== 'boolean') {
    throw new Error(INVALID_CATALOG_DATA);
  }

  return Object.freeze({
    id: requiredString(row.app_id),
    slug: requiredString(row.slug),
    title: requiredString(row.title),
    shortDescription: requiredString(row.short_description),
    iconPath: row.icon_path,
    category,
    featured: row.featured,
    downloadCount: nonNegativeNumber(row.download_count),
    currentVersion,
  });
}

export function mapCatalogApp(row: CatalogAppRow): CatalogApp {
  const versions = Object.freeze(row.versions.map(version => mapVersion(version)));
  const currentVersion = versions[0];
  if (!currentVersion) {
    throw new Error(INVALID_CATALOG_DATA);
  }

  const screenshots = Object.freeze(
    row.screenshots.map<CatalogScreenshot>(screenshot =>
      Object.freeze({
        id: requiredString(screenshot.id),
        path: requiredString(screenshot.path),
        altText: requiredString(screenshot.alt_text),
        position: nonNegativeNumber(screenshot.position),
      }),
    ),
  );

  return Object.freeze({
    id: requiredString(row.id),
    slug: requiredString(row.slug),
    title: requiredString(row.title),
    shortDescription: requiredString(row.short_description),
    description: requiredString(row.description),
    iconPath: row.icon_path,
    category: mapCategory(row.category),
    featured: row.featured,
    downloadCount: nonNegativeNumber(row.download_count),
    currentVersion,
    versions,
    screenshots,
  });
}
