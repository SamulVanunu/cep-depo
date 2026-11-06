import { describe, expect, it, vi } from 'vitest';

import {
  CATALOG_BUCKET,
  catalogReferenceKey,
  isCatalogReleaseRetained,
  isLiveCatalogReference,
  readCatalogReferenceKeys,
  type CatalogPointer,
  type CatalogReferenceSources,
  type LiveCatalogClient,
} from './live-catalog';

const appId = 'a2000000-0000-4000-8000-000000000001';
const versionId = 'a3000000-0000-4000-8000-000000000001';
const fileId = 'a4000000-0000-4000-8000-000000000001';
const apkPath = `apps/${appId}/versions/${versionId}.apk`;
const iconPath = `apps/${appId}/icons/${fileId}.png`;
const releaseOne = 'rel_12345678';
const releaseTwo = 'rel_87654321';
const releaseOneApps = `releases/${releaseOne}/apps.json`;
const releaseTwoApps = `releases/${releaseTwo}/apps.json`;

type Download = Readonly<{ data: unknown; error: unknown }>;

function ok(text: string): Download {
  return { data: text, error: null };
}

function missing(): Download {
  return {
    data: null,
    error: Object.assign(new Error('Object not found'), { status: 404 }),
  };
}

function failed(message = 'storage down'): Download {
  return { data: null, error: Object.assign(new Error(message), { status: 500 }) };
}

function apps(entries: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-11-04T12:00:00.000Z',
    apps: entries,
  });
}

function clientReturning(
  results: Record<string, Download | (() => Promise<never>)>,
) {
  const download = vi.fn((path: string) => {
    const result = results[path];
    if (!result) throw new Error(`unexpected download path: ${path}`);
    return typeof result === 'function' ? result() : Promise.resolve(result);
  });
  const from = vi.fn(() => ({ download }));
  return {
    client: { storage: { from } } as unknown as LiveCatalogClient,
    download,
    from,
  };
}

function pointer(overrides: Partial<CatalogPointer> = {}): CatalogPointer {
  return {
    generation: 10,
    releaseId: releaseOne,
    retainedFromGeneration: 6,
    reconciliationRequired: false,
    ...overrides,
  };
}

function sources(
  pointerRow: CatalogPointer = pointer(),
  releases: readonly string[] = [releaseOne],
  releaseExists: (releaseId: string) => Promise<boolean> = async () => false,
) {
  const pointerFn = vi.fn(async () => pointerRow);
  const releasesFn = vi.fn(async (_fromGeneration: number) => releases);
  const existsFn = vi.fn(releaseExists);
  const source: CatalogReferenceSources = {
    pointer: pointerFn,
    retainedReleases: releasesFn,
    releaseExists: existsFn,
  };
  return { source, pointerFn, releasesFn, existsFn };
}

describe('readCatalogReferenceKeys', () => {
  it('reads the legacy root apps.json at generation zero and never touches the manifest', async () => {
    const subject = clientReturning({
      'apps.json': ok(apps([{ apk_path: apkPath, icon_path: iconPath }])),
    });
    const { source, releasesFn } = sources(
      pointer({ generation: 0, releaseId: null, retainedFromGeneration: 0 }),
      [],
    );

    const keys = await readCatalogReferenceKeys(subject.client, { sources: source });

    expect([...keys].sort()).toEqual(
      [
        catalogReferenceKey('apks', apkPath),
        catalogReferenceKey('app-assets', iconPath),
      ].sort(),
    );
    expect(releasesFn).not.toHaveBeenCalled();
    expect(subject.download.mock.calls.map(([path]) => path)).toEqual(['apps.json']);
    expect(subject.download.mock.calls.map(([path]) => path)).not.toContain(
      'manifest.json',
    );
  });

  it('returns an empty set at generation zero when the legacy root apps.json is missing', async () => {
    const subject = clientReturning({ 'apps.json': missing() });
    const { source } = sources(
      pointer({ generation: 0, releaseId: null, retainedFromGeneration: 0 }),
      [],
    );

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).resolves.toEqual(new Set());
  });

  it('reads every retained release plus the legacy root apps.json', async () => {
    const subject = clientReturning({
      [releaseOneApps]: ok(apps([{ apk_path: apkPath, icon_path: null }])),
      [releaseTwoApps]: ok(apps([{ apk_path: null, icon_path: iconPath }])),
      'apps.json': ok(apps([{ apk_path: `${apkPath}.legacy`, icon_path: null }])),
    });
    const { source, releasesFn } = sources(pointer(), [releaseOne, releaseTwo]);

    const keys = await readCatalogReferenceKeys(subject.client, { sources: source });

    expect(releasesFn).toHaveBeenCalledWith(6);
    expect(keys).toEqual(
      new Set([
        catalogReferenceKey('apks', apkPath),
        catalogReferenceKey('app-assets', iconPath),
        catalogReferenceKey('apks', `${apkPath}.legacy`),
      ]),
    );
  });

  it('works without a legacy root apps.json once a release exists', async () => {
    const subject = clientReturning({
      [releaseOneApps]: ok(apps([{ apk_path: apkPath, icon_path: iconPath }])),
      'apps.json': missing(),
    });
    const { source } = sources(pointer());

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).resolves.toEqual(
      new Set([
        catalogReferenceKey('apks', apkPath),
        catalogReferenceKey('app-assets', iconPath),
      ]),
    );
  });

  it('keys references by bucket and path, not by path alone', async () => {
    const subject = clientReturning({
      [releaseOneApps]: ok(apps([{ apk_path: apkPath, icon_path: apkPath }])),
      'apps.json': missing(),
    });
    const { source } = sources(pointer());

    const keys = await readCatalogReferenceKeys(subject.client, { sources: source });

    expect(keys.has(catalogReferenceKey('apks', apkPath))).toBe(true);
    expect(keys.has(catalogReferenceKey('app-assets', apkPath))).toBe(true);
    expect(catalogReferenceKey('apks', apkPath)).not.toBe(
      catalogReferenceKey('app-assets', apkPath),
    );
  });

  it('fails closed when the pointer cannot be read', async () => {
    const subject = clientReturning({});
    const source: CatalogReferenceSources = {
      pointer: async () => {
        throw new Error('pointer query failed');
      },
      retainedReleases: async () => [releaseOne],
      releaseExists: async () => false,
    };

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/pointer query failed/i);
  });

  it('fails closed when reconciliation is required', async () => {
    const subject = clientReturning({
      [releaseOneApps]: ok(apps([{ apk_path: apkPath, icon_path: null }])),
    });
    const { source, releasesFn } = sources(
      pointer({ reconciliationRequired: true }),
    );

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/mutabakat/i);
    expect(releasesFn).not.toHaveBeenCalled();
  });

  it('fails closed when a non-zero generation has no release id', async () => {
    const subject = clientReturning({});
    const { source } = sources(pointer({ releaseId: null }));

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/yayın kimliği/i);
  });

  it('fails closed when no retained release can be resolved', async () => {
    const subject = clientReturning({ 'apps.json': missing() });
    const { source } = sources(pointer(), []);

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/release|yayın/i);
  });

  it('fails closed when the retained history query fails', async () => {
    const subject = clientReturning({});
    const source: CatalogReferenceSources = {
      pointer: async () => pointer(),
      retainedReleases: async () => {
        throw new Error('history query failed');
      },
      releaseExists: async () => false,
    };

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/history query failed/i);
  });

  it('refuses a release id outside the consumer pattern', async () => {
    const subject = clientReturning({});
    const { source } = sources(pointer(), ['../secret']);

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/yayın kimliği/i);
  });

  it('fails closed when a retained release apps.json is missing', async () => {
    const subject = clientReturning({
      [releaseOneApps]: missing(),
      'apps.json': missing(),
    });
    const { source } = sources(pointer());

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/bulunamadı/i);
  });

  it('fails closed when a retained release apps.json is not valid JSON', async () => {
    const subject = clientReturning({
      [releaseOneApps]: ok('{not json'),
      'apps.json': missing(),
    });
    const { source } = sources(pointer());

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/JSON/i);
  });

  it('fails closed when a retained release has no apps array', async () => {
    const subject = clientReturning({
      [releaseOneApps]: ok(JSON.stringify({ schemaVersion: 2, apps: {} })),
      'apps.json': missing(),
    });
    const { source } = sources(pointer());

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/apps/i);
  });

  it('fails closed when a catalog path is not a string', async () => {
    const subject = clientReturning({
      [releaseOneApps]: ok(apps([{ apk_path: 42, icon_path: iconPath }])),
      'apps.json': missing(),
    });
    const { source } = sources(pointer());

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/apk_path|yol/i);
  });

  it('fails closed when the legacy root apps.json is not valid JSON', async () => {
    const subject = clientReturning({ 'apps.json': ok('{not json') });
    const { source } = sources(
      pointer({ generation: 0, releaseId: null, retainedFromGeneration: 0 }),
      [],
    );

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/JSON/i);
  });

  it('fails closed when the legacy root apps.json cannot be read', async () => {
    const subject = clientReturning({ 'apps.json': failed() });
    const { source } = sources(
      pointer({ generation: 0, releaseId: null, retainedFromGeneration: 0 }),
      [],
    );

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source }),
    ).rejects.toThrow(/okunamadı/i);
  });

  it('fails closed when the catalog read times out', async () => {
    const subject = clientReturning({
      'apps.json': () => new Promise<never>(() => {}),
    });
    const { source } = sources(
      pointer({ generation: 0, releaseId: null, retainedFromGeneration: 0 }),
      [],
    );

    await expect(
      readCatalogReferenceKeys(subject.client, { sources: source, timeoutMs: 5 }),
    ).rejects.toThrow(/zaman aşımı/i);
  });

  it('reads from the catalog bucket only', async () => {
    const subject = clientReturning({ 'apps.json': missing() });
    const { source } = sources(
      pointer({ generation: 0, releaseId: null, retainedFromGeneration: 0 }),
      [],
    );

    await readCatalogReferenceKeys(subject.client, { sources: source });

    expect(subject.from).toHaveBeenCalledWith(CATALOG_BUCKET);
  });
});

describe('isCatalogReleaseRetained', () => {
  it('treats the current release as retained without reading history', async () => {
    const { source, releasesFn, existsFn } = sources(pointer(), [releaseOne]);

    await expect(isCatalogReleaseRetained(releaseOne, source)).resolves.toBe(true);
    expect(releasesFn).not.toHaveBeenCalled();
    expect(existsFn).not.toHaveBeenCalled();
  });

  it('treats a release inside the retained window as retained', async () => {
    const { source, releasesFn, existsFn } = sources(pointer(), [
      releaseOne,
      releaseTwo,
    ]);

    await expect(isCatalogReleaseRetained(releaseTwo, source)).resolves.toBe(true);
    expect(releasesFn).toHaveBeenCalledWith(6);
    expect(existsFn).not.toHaveBeenCalled();
  });

  it('treats a release absent from history as retained', async () => {
    const { source, existsFn } = sources(pointer(), [releaseOne], async () => false);

    await expect(isCatalogReleaseRetained(releaseTwo, source)).resolves.toBe(true);
    expect(existsFn).toHaveBeenCalledWith(releaseTwo);
  });

  it('treats a release below the window as eligible for deletion', async () => {
    const { source } = sources(pointer(), [releaseOne], async () => true);

    await expect(isCatalogReleaseRetained(releaseTwo, source)).resolves.toBe(false);
  });

  it('treats generation zero as retained and never consults history', async () => {
    const { source, releasesFn } = sources(
      pointer({ generation: 0, releaseId: null, retainedFromGeneration: 0 }),
      [],
    );

    await expect(isCatalogReleaseRetained(releaseTwo, source)).resolves.toBe(true);
    expect(releasesFn).not.toHaveBeenCalled();
  });

  it('fails closed while reconciliation is active', async () => {
    const { source, releasesFn } = sources(
      pointer({ reconciliationRequired: true }),
    );

    await expect(isCatalogReleaseRetained(releaseTwo, source)).rejects.toThrow(
      /mutabakat/i,
    );
    expect(releasesFn).not.toHaveBeenCalled();
  });

  it('fails closed when the pointer cannot be read', async () => {
    const source: CatalogReferenceSources = {
      pointer: async () => {
        throw new Error('pointer query failed');
      },
      retainedReleases: async () => [releaseOne],
      releaseExists: async () => false,
    };

    await expect(isCatalogReleaseRetained(releaseTwo, source)).rejects.toThrow(
      /pointer query failed/i,
    );
  });

  it('fails closed when the history cannot be read', async () => {
    const source: CatalogReferenceSources = {
      pointer: async () => pointer(),
      retainedReleases: async () => {
        throw new Error('history query failed');
      },
      releaseExists: async () => false,
    };

    await expect(isCatalogReleaseRetained(releaseTwo, source)).rejects.toThrow(
      /history query failed/i,
    );
  });
});

describe('isLiveCatalogReference', () => {
  it('refuses the catalog bucket instead of silently answering false', async () => {
    const keys = vi.fn(async () => new Set<string>());

    await expect(
      isLiveCatalogReference('catalog', `releases/${releaseOne}/apps.json`, keys),
    ).rejects.toThrow(/katalog/i);
    expect(keys).not.toHaveBeenCalled();
  });

  it('never reads the catalog for apk drafts', async () => {
    const keys = vi.fn(async () => new Set<string>());

    await expect(isLiveCatalogReference('apk-drafts', 'operations/x/source.apk', keys))
      .resolves.toBe(false);
    expect(keys).not.toHaveBeenCalled();
  });

  it('answers from the cached reference keys for asset buckets', async () => {
    const keys = vi.fn(
      async () => new Set([catalogReferenceKey('apks', apkPath)]),
    );

    await expect(isLiveCatalogReference('apks', apkPath, keys)).resolves.toBe(true);
    await expect(isLiveCatalogReference('app-assets', iconPath, keys)).resolves.toBe(
      false,
    );
    expect(keys).toHaveBeenCalledTimes(2);
  });
});
