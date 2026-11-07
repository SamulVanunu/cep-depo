import { describe, expect, it } from 'vitest';

import { buildStaticCatalog, mapSourceApp } from './build';
import type {
  StaticCatalogSourceApp,
  StaticCatalogSourceCategory,
  StaticCatalogSourceVersion,
} from './types';

const category: StaticCatalogSourceCategory = {
  id: 'cat-1',
  slug: 'eglence',
  name: 'Eğlence',
  position: 10,
  is_active: true,
};

function version(overrides: Partial<StaticCatalogSourceVersion> = {}): StaticCatalogSourceVersion {
  return {
    id: 'ver-1',
    version_name: '1.2.0',
    version_code: 12,
    changelog: 'Düzeltmeler',
    download_source: 'storage',
    apk_path: 'apps/app-1/app.apk',
    apk_url: null,
    apk_size_bytes: 1_000_000,
    sha256: 'a'.repeat(64),
    published_at: '2026-11-01T10:00:00Z',
    supports_mobile: true,
    supports_tv: false,
    account_requirement: 'none',
    status: 'published',
    ...overrides,
  };
}

function app(overrides: Partial<StaticCatalogSourceApp> = {}): StaticCatalogSourceApp {
  return {
    id: 'app-1',
    slug: 'ornek-uygulama',
    title: 'Örnek Uygulama',
    short_description: 'Kısa açıklama.',
    description: 'Uzun açıklama.',
    icon_path: 'apps/app-1/icon.png',
    featured: true,
    download_count: 5,
    status: 'active',
    category,
    versions: [version()],
    screenshots: [
      { id: 'shot-2', path: 'apps/app-1/2.png', alt_text: 'İkinci', position: 2 },
      { id: 'shot-1', path: 'apps/app-1/1.png', alt_text: 'Birinci', position: 1 },
    ],
    ...overrides,
  };
}

function documents(bundle: ReturnType<typeof buildStaticCatalog>) {
  return Object.fromEntries(bundle.files.map(file => [file.path, JSON.parse(file.content)]));
}

describe('buildStaticCatalog', () => {
  it('builds homescreen, categories, about, per-app and manifest documents', () => {
    const bundle = buildStaticCatalog([app()], [category], { generatedAt: '2026-11-07T12:00:00.000Z' });
    const docs = documents(bundle);

    expect(bundle.appCount).toBe(1);
    expect(bundle.categoryCount).toBe(1);
    expect(Object.keys(docs).sort()).toEqual([
      'about.json',
      'apps/ornek-uygulama.json',
      'categories.json',
      'homescreen.json',
      'manifest.json',
    ]);
    expect(docs['homescreen.json']).toMatchObject({
      schemaVersion: 1,
      home: { featuredSlugs: ['ornek-uygulama'] },
      apps: [{ slug: 'ornek-uygulama', currentVersion: { code: 12 } }],
    });
    expect(docs['categories.json'].categories).toEqual([
      { id: 'cat-1', slug: 'eglence', name: 'Eğlence', position: 10, appCount: 1 },
    ]);
    expect(docs['apps/ornek-uygulama.json'].app.screenshots.map((shot: { id: string }) => shot.id)).toEqual([
      'shot-1',
      'shot-2',
    ]);
    expect(docs['manifest.json'].files.apps).toEqual(['apps/ornek-uygulama.json']);
  });

  it('uses the newest published version as the current one', () => {
    const bundle = buildStaticCatalog(
      [app({ versions: [version({ id: 'v1', version_code: 1 }), version({ id: 'v2', version_code: 20 })] })],
      [category],
      { generatedAt: '2026-11-07T12:00:00.000Z' },
    );
    const docs = documents(bundle);
    expect(docs['homescreen.json'].apps[0].currentVersion.id).toBe('v2');
    expect(docs['apps/ornek-uygulama.json'].app.versions.map((item: { id: string }) => item.id)).toEqual([
      'v2',
      'v1',
    ]);
  });

  it('reports why an app is missing instead of silently dropping it', () => {
    const bundle = buildStaticCatalog(
      [
        app({ id: 'app-52', slug: 'bozuk-uygulama', title: 'Bozuk', versions: [version({ status: 'draft' })] }),
        app({ id: 'app-53', slug: 'kategorisiz', title: 'Kategorisiz', category: null }),
      ],
      [category],
      { generatedAt: '2026-11-07T12:00:00.000Z' },
    );

    expect(bundle.appCount).toBe(0);
    expect(bundle.skipped).toEqual([
      expect.objectContaining({ slug: 'bozuk-uygulama', reason: 'no-published-version' }),
      expect.objectContaining({ slug: 'kategorisiz', reason: 'category-missing' }),
    ]);
  });

  it('reports an inactive app by name instead of hiding it', () => {
    const result = mapSourceApp(
      app({ id: 'app-52', slug: 'pasif-uygulama', title: 'Pasif Uygulama', status: 'archived' }),
    );
    expect('skip' in result && result.skip).toEqual(
      expect.objectContaining({
        id: 'app-52',
        slug: 'pasif-uygulama',
        title: 'Pasif Uygulama',
        reason: 'app-inactive',
      }),
    );
  });

  it('skips an app whose published version cannot provide an APK source', () => {
    const result = mapSourceApp(
      app({ versions: [version({ download_source: 'storage', apk_path: null })] }),
    );
    expect('skip' in result && result.skip.reason).toBe('invalid-version');
  });

  it('is byte-stable for the same input', () => {
    const first = buildStaticCatalog([app()], [category], { generatedAt: '2026-11-07T12:00:00.000Z' });
    const second = buildStaticCatalog([app()], [category], { generatedAt: '2026-11-07T12:00:00.000Z' });
    expect(first.files).toEqual(second.files);
  });
});
