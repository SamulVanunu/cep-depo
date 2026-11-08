import {
  STATIC_CATALOG_SCHEMA_VERSION,
  type StaticCatalogAbout,
  type StaticCatalogApp,
  type StaticCatalogAppDocument,
  type StaticCatalogBundle,
  type StaticCatalogCard,
  type StaticCatalogCategoriesDocument,
  type StaticCatalogCategory,
  type StaticCatalogFile,
  type StaticCatalogHome,
  type StaticCatalogHomescreenDocument,
  type StaticCatalogManifest,
  type StaticCatalogSourceApp,
  type StaticCatalogSourceCategory,
  type StaticCatalogSourceVersion,
  type StaticCatalogSkip,
  type StaticCatalogSkipReason,
  type StaticCatalogVersion,
} from './types';

const INVALID = 'Statik katalog verisi eksik veya geçersiz.';

export const DEFAULT_HOME: StaticCatalogHome = Object.freeze({
  wordmark: 'cep depo',
  heroTitle: 'Uygulamanı keşfet.',
  heroSubtitle: 'Bağımsız Android uygulamalarını sade ve güvenilir bir katalogda bul.',
  featuredSlugs: Object.freeze([]),
});

export const DEFAULT_ABOUT: StaticCatalogAbout = Object.freeze({
  title: 'Hakkında',
  description: 'Android uygulamalarını keşfetmenin sade, editoryal ve işlevsel yolu.',
  openSourceTitle: 'Açık kaynak',
  openSourceBody:
    'Cep Depo; Expo, React Native, TanStack Query ve Supabase dahil açık kaynak bileşenler kullanır. Paket lisansları dağıtım kaynaklarıyla birlikte sunulur.',
});

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(INVALID);
  return value;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(INVALID);
  }
  return value;
}

function nonNegativeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(INVALID);
  }
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(INVALID);
  return value;
}

function compareText(left: string, right: string): number {
  return left.toLowerCase() < right.toLowerCase() ? -1 : left.toLowerCase() > right.toLowerCase() ? 1 : left < right ? -1 : left > right ? 1 : 0;
}

function mapApkSource(row: StaticCatalogSourceVersion) {
  if (row.download_source === 'storage' && row.apk_path && row.apk_url === null) {
    return Object.freeze({ kind: 'storage' as const, path: requiredText(row.apk_path) });
  }
  if (row.download_source === 'external' && row.apk_path === null && row.apk_url) {
    return Object.freeze({ kind: 'external' as const, url: requiredText(row.apk_url) });
  }
  throw new Error(INVALID);
}

function mapVersion(row: StaticCatalogSourceVersion): StaticCatalogVersion {
  if (row.account_requirement !== 'none' && row.account_requirement !== 'optional' && row.account_requirement !== 'required') {
    throw new Error(INVALID);
  }
  return Object.freeze({
    id: requiredText(row.id),
    name: requiredText(row.version_name),
    code: positiveInteger(row.version_code),
    changelog: optionalText(row.changelog),
    apkSource: mapApkSource(row),
    apkSizeBytes: positiveInteger(row.apk_size_bytes),
    sha256: requiredText(row.sha256),
    publishedAt: requiredText(row.published_at),
    supportsMobile: requiredBoolean(row.supports_mobile),
    supportsTv: requiredBoolean(row.supports_tv),
    accountRequirement: row.account_requirement,
  });
}

function mapCategory(category: StaticCatalogSourceCategory): StaticCatalogCategory {
  return Object.freeze({
    id: requiredText(category.id),
    slug: requiredText(category.slug),
    name: requiredText(category.name),
    position: nonNegativeNumber(category.position),
  });
}

function sortVersions(versions: readonly StaticCatalogVersion[]): StaticCatalogVersion[] {
  return [...versions].sort((left, right) => right.code - left.code || compareText(left.id, right.id));
}

function toCard(app: StaticCatalogApp): StaticCatalogCard {
  return Object.freeze({
    id: app.id,
    slug: app.slug,
    title: app.title,
    shortDescription: app.shortDescription,
    iconPath: app.iconPath,
    category: app.category,
    featured: app.featured,
    downloadCount: app.downloadCount,
    currentVersion: app.currentVersion,
  });
}

function skip(
  app: StaticCatalogSourceApp,
  reason: StaticCatalogSkipReason,
  detail: string,
): StaticCatalogSkip {
  return Object.freeze({
    id: typeof app.id === 'string' ? app.id : '',
    slug: typeof app.slug === 'string' ? app.slug : '',
    title: typeof app.title === 'string' ? app.title : '',
    reason,
    detail,
  });
}

/**
 * Converts one database app into the static document shape, or reports why it
 * cannot be published. A single broken app must never take the whole catalog
 * down; the panel surfaces every skip so a missing app (like a broken #52) is
 * diagnosable instead of silently absent.
 */
export function mapSourceApp(
  app: StaticCatalogSourceApp,
): Readonly<{ app: StaticCatalogApp }> | Readonly<{ skip: StaticCatalogSkip }> {
  if (app.status !== 'active') {
    return { skip: skip(app, 'app-inactive', 'Uygulama aktif durumda değil.') };
  }
  if (!app.category) {
    return { skip: skip(app, 'category-missing', 'Uygulamanın kategorisi yok.') };
  }
  if (!app.category.is_active) {
    return { skip: skip(app, 'category-inactive', 'Uygulamanın kategorisi pasif.') };
  }
  const published = app.versions.filter(version => version.status === 'published');
  if (published.length === 0) {
    return { skip: skip(app, 'no-published-version', 'Yayımlanmış sürümü yok.') };
  }

  let category: StaticCatalogCategory;
  try {
    category = mapCategory(app.category);
  } catch {
    return { skip: skip(app, 'invalid-app', 'Kategori bilgisi geçersiz.') };
  }

  const versions: StaticCatalogVersion[] = [];
  for (const version of published) {
    try {
      versions.push(mapVersion(version));
    } catch {
      return {
        skip: skip(app, 'invalid-version', `Sürüm ${version.version_name ?? version.id ?? ''} doğrulanamadı.`),
      };
    }
  }

  let id: string;
  let slug: string;
  let title: string;
  let shortDescription: string;
  let description: string;
  let featured: boolean;
  let downloadCount: number;
  try {
    id = requiredText(app.id);
    slug = requiredText(app.slug);
    title = requiredText(app.title);
    shortDescription = requiredText(app.short_description);
    description = requiredText(app.description);
    featured = requiredBoolean(app.featured);
    downloadCount = nonNegativeNumber(app.download_count);
  } catch {
    return { skip: skip(app, 'invalid-app', 'Uygulama bilgileri geçersiz.') };
  }

  const screenshots = app.screenshots
    .filter(screenshot => {
      try {
        requiredText(screenshot.id);
        requiredText(screenshot.path);
        requiredText(screenshot.alt_text);
        nonNegativeNumber(screenshot.position);
        return true;
      } catch {
        return false;
      }
    })
    .map(screenshot =>
      Object.freeze({
        id: screenshot.id,
        path: screenshot.path,
        altText: screenshot.alt_text,
        position: screenshot.position,
      }),
    )
    .sort((left, right) => left.position - right.position || compareText(left.id, right.id));

  const orderedVersions = Object.freeze(sortVersions(versions));
  const mapped = Object.freeze({
    id,
    slug,
    title,
    shortDescription,
    description,
    iconPath: typeof app.icon_path === 'string' && app.icon_path.trim().length > 0 ? app.icon_path : null,
    category,
    featured,
    downloadCount,
    currentVersion: orderedVersions[0],
    screenshots: Object.freeze(screenshots),
    versions: orderedVersions,
  }) as StaticCatalogApp;

  return { app: mapped };
}

export function buildStaticCatalog(
  apps: readonly StaticCatalogSourceApp[],
  categories: readonly StaticCatalogSourceCategory[],
  options: { generatedAt: string; home?: Partial<StaticCatalogHome>; about?: Partial<StaticCatalogAbout> },
): StaticCatalogBundle {
  const generatedAt = requiredText(options.generatedAt);

  const activeCategories = categories
    .filter(category => category.is_active)
    .map(category => mapCategory(category))
    .sort((left, right) => left.position - right.position || compareText(left.name, right.name) || compareText(left.id, right.id));

  const included: StaticCatalogApp[] = [];
  const skipped: StaticCatalogSkip[] = [];
  for (const source of apps) {
    const result = mapSourceApp(source);
    if ('skip' in result) skipped.push(result.skip);
    else included.push(result.app);
  }

  included.sort(
    (left, right) =>
      Number(right.featured) - Number(left.featured) ||
      compareText(left.title, right.title) ||
      compareText(left.slug, right.slug),
  );
  skipped.sort((left, right) => compareText(left.slug, right.slug) || compareText(left.id, right.id));

  const home: StaticCatalogHome = Object.freeze({
    wordmark: requiredText(options.home?.wordmark ?? DEFAULT_HOME.wordmark),
    heroTitle: requiredText(options.home?.heroTitle ?? DEFAULT_HOME.heroTitle),
    heroSubtitle: requiredText(options.home?.heroSubtitle ?? DEFAULT_HOME.heroSubtitle),
    featuredSlugs: Object.freeze(included.filter(app => app.featured).map(app => app.slug)),
  });
  const about: StaticCatalogAbout = Object.freeze({
    title: requiredText(options.about?.title ?? DEFAULT_ABOUT.title),
    description: requiredText(options.about?.description ?? DEFAULT_ABOUT.description),
    openSourceTitle: requiredText(options.about?.openSourceTitle ?? DEFAULT_ABOUT.openSourceTitle),
    openSourceBody: requiredText(options.about?.openSourceBody ?? DEFAULT_ABOUT.openSourceBody),
  });

  const cards = included.map(toCard);
  const appsPaths = included.map(app => `apps/${app.slug}.json`);

  const homescreen: StaticCatalogHomescreenDocument = Object.freeze({
    schemaVersion: STATIC_CATALOG_SCHEMA_VERSION,
    generatedAt,
    home,
    apps: Object.freeze(cards),
  });

  const categoriesDocument: StaticCatalogCategoriesDocument = Object.freeze({
    schemaVersion: STATIC_CATALOG_SCHEMA_VERSION,
    generatedAt,
    categories: Object.freeze(
      activeCategories.map(category =>
        Object.freeze({
          ...category,
          appCount: included.filter(app => app.category.id === category.id).length,
        }),
      ),
    ),
  });

  const aboutDocument = Object.freeze({
    schemaVersion: STATIC_CATALOG_SCHEMA_VERSION,
    generatedAt,
    about,
  });

  const appDocuments: StaticCatalogAppDocument[] = included.map(app =>
    Object.freeze({
      schemaVersion: STATIC_CATALOG_SCHEMA_VERSION,
      generatedAt,
      app,
    }),
  );

  const manifest: StaticCatalogManifest = Object.freeze({
    schemaVersion: STATIC_CATALOG_SCHEMA_VERSION,
    generatedAt,
    appCount: included.length,
    categoryCount: activeCategories.length,
    files: Object.freeze({
      homescreen: 'homescreen.json',
      categories: 'categories.json',
      about: 'about.json',
      apps: Object.freeze(appsPaths),
    }),
  });

  const files: StaticCatalogFile[] = [
    { path: 'homescreen.json', content: JSON.stringify(homescreen) },
    { path: 'categories.json', content: JSON.stringify(categoriesDocument) },
    { path: 'about.json', content: JSON.stringify(aboutDocument) },
    ...appDocuments.map((document, index) => ({
      path: appsPaths[index],
      content: JSON.stringify(document),
    })),
    { path: 'manifest.json', content: JSON.stringify(manifest) },
  ];

  return Object.freeze({
    generatedAt,
    appCount: included.length,
    categoryCount: activeCategories.length,
    files: Object.freeze(files),
    skipped: Object.freeze(skipped),
  });
}
