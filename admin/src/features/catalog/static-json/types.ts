/**
 * Static catalog JSON v1.
 *
 * The panel writes these documents to a GitHub repository; the mobile app
 * reads them from a public base URL. The shape intentionally mirrors the
 * mobile catalog types so the app can consume the documents without a DB
 * round-trip. Reviews, reports and other fast-moving data stay in Postgres.
 */

export const STATIC_CATALOG_SCHEMA_VERSION = 1 as const;

export type StaticCatalogAccountRequirement = 'none' | 'optional' | 'required';

export type StaticCatalogApkSource =
  | Readonly<{ kind: 'storage'; path: string }>
  | Readonly<{ kind: 'external'; url: string }>;

export type StaticCatalogVersion = Readonly<{
  id: string;
  name: string;
  code: number;
  changelog: string;
  apkSource: StaticCatalogApkSource;
  apkSizeBytes: number;
  sha256: string;
  publishedAt: string;
  supportsMobile: boolean;
  supportsTv: boolean;
  accountRequirement: StaticCatalogAccountRequirement;
}>;

export type StaticCatalogCategory = Readonly<{
  id: string;
  slug: string;
  name: string;
  position: number;
}>;

export type StaticCatalogCard = Readonly<{
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  iconPath: string | null;
  category: StaticCatalogCategory;
  featured: boolean;
  downloadCount: number;
  currentVersion: StaticCatalogVersion;
}>;

export type StaticCatalogScreenshot = Readonly<{
  id: string;
  path: string;
  altText: string;
  position: number;
}>;

export type StaticCatalogApp = StaticCatalogCard &
  Readonly<{
    description: string;
    screenshots: readonly StaticCatalogScreenshot[];
    versions: readonly StaticCatalogVersion[];
  }>;

export type StaticCatalogHome = Readonly<{
  wordmark: string;
  heroTitle: string;
  heroSubtitle: string;
  featuredSlugs: readonly string[];
}>;

export type StaticCatalogAbout = Readonly<{
  title: string;
  description: string;
  openSourceTitle: string;
  openSourceBody: string;
}>;

export type StaticCatalogManifest = Readonly<{
  schemaVersion: typeof STATIC_CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  appCount: number;
  categoryCount: number;
  files: Readonly<{
    homescreen: 'homescreen.json';
    categories: 'categories.json';
    about: 'about.json';
    apps: readonly string[];
  }>;
}>;

export type StaticCatalogHomescreenDocument = Readonly<{
  schemaVersion: typeof STATIC_CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  home: StaticCatalogHome;
  apps: readonly StaticCatalogCard[];
}>;

export type StaticCatalogCategoriesDocument = Readonly<{
  schemaVersion: typeof STATIC_CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  categories: readonly (StaticCatalogCategory & Readonly<{ appCount: number }>)[];
}>;

export type StaticCatalogAboutDocument = Readonly<{
  schemaVersion: typeof STATIC_CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  about: StaticCatalogAbout;
}>;

export type StaticCatalogAppDocument = Readonly<{
  schemaVersion: typeof STATIC_CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  app: StaticCatalogApp;
}>;

export type StaticCatalogFile = Readonly<{
  /** Repository-relative path, for example `apps/reeltu-mobil.json`. */
  path: string;
  content: string;
}>;

export type StaticCatalogSkipReason =
  | 'app-inactive'
  | 'category-missing'
  | 'category-inactive'
  | 'no-published-version'
  | 'invalid-app'
  | 'invalid-version';

export type StaticCatalogSkip = Readonly<{
  id: string;
  slug: string;
  title: string;
  reason: StaticCatalogSkipReason;
  detail: string;
}>;

export type StaticCatalogBundle = Readonly<{
  generatedAt: string;
  appCount: number;
  categoryCount: number;
  files: readonly StaticCatalogFile[];
  skipped: readonly StaticCatalogSkip[];
}>;

export type StaticCatalogSourceVersion = Readonly<{
  id: string;
  version_name: string;
  version_code: number;
  changelog: string | null;
  download_source: 'storage' | 'external';
  apk_path: string | null;
  apk_url: string | null;
  apk_size_bytes: number;
  sha256: string;
  published_at: string | null;
  supports_mobile: boolean;
  supports_tv: boolean;
  account_requirement: StaticCatalogAccountRequirement;
  status: 'draft' | 'published' | 'withdrawn';
}>;

export type StaticCatalogSourceScreenshot = Readonly<{
  id: string;
  path: string;
  alt_text: string;
  position: number;
}>;

export type StaticCatalogSourceCategory = Readonly<{
  id: string;
  slug: string;
  name: string;
  position: number;
  is_active: boolean;
}>;

export type StaticCatalogSourceApp = Readonly<{
  id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  icon_path: string | null;
  featured: boolean;
  download_count: number;
  status: 'active' | 'archived';
  category: StaticCatalogSourceCategory | null;
  versions: readonly StaticCatalogSourceVersion[];
  screenshots: readonly StaticCatalogSourceScreenshot[];
}>;

export type StaticCatalogBuildOptions = Readonly<{
  generatedAt: string;
  home?: Partial<StaticCatalogHome>;
  about?: Partial<StaticCatalogAbout>;
}>;
