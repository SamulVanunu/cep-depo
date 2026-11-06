import { describe, expect, it, vi } from 'vitest';

import { runCleanupSweep, type StorageEntry, type SweepDependencies } from './cleanup-sweeper';

const APP = 'c2000000-0000-4000-8000-000000000001';
const APP2 = 'c2000000-0000-4000-8000-000000000002';
const VERSION = 'c3000000-0000-4000-8000-000000000001';
const VERSION2 = 'c3000000-0000-4000-8000-000000000002';
const DRAFT = 'c4000000-0000-4000-8000-000000000001';
const FILE = 'c5000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-01T12:00:00.000Z');

function folder(name: string): StorageEntry {
  return { name, isFolder: true, createdAt: null };
}

function file(name: string, ageMs: number | null): StorageEntry {
  return {
    name,
    isFolder: false,
    createdAt: ageMs === null ? null : new Date(NOW - ageMs).toISOString(),
  };
}

type Tree = Readonly<Record<string, readonly StorageEntry[]>>;

function treeDependencies(
  tree: Tree,
  overrides: Partial<SweepDependencies> = {},
): SweepDependencies {
  return {
    loadCursor: vi.fn(async () => ({ bucket: 'apk-drafts' as const, lastFolder: null })),
    saveCursor: vi.fn(async () => undefined),
    list: vi.fn(async (bucket: string, prefix: string) => ({
      entries: tree[`${bucket}:${prefix}`] ?? [],
      hasMore: false,
    })),
    isReferenced: vi.fn(async () => false),
    enqueueOrphan: vi.fn(async () => 'c6000000-0000-4000-8000-000000000001'),
    now: () => NOW,
    ...overrides,
  };
}

const draftTree: Tree = {
  'apk-drafts:': [folder('operations')],
  'apk-drafts:operations/': [folder(DRAFT)],
  [`apk-drafts:operations/${DRAFT}/`]: [file('source.apk', 25 * 3_600_000)],
};

describe('runCleanupSweep', () => {
  it('ignores objects younger than the grace period', async () => {
    const subject = treeDependencies({
      'apk-drafts:': [folder('operations')],
      'apk-drafts:operations/': [folder(DRAFT)],
      [`apk-drafts:operations/${DRAFT}/`]: [file('source.apk', 3_600_000)],
    });

    const counters = await runCleanupSweep(subject);

    expect(subject.enqueueOrphan).not.toHaveBeenCalled();
    expect(counters.scanned).toBe(1);
    expect(counters.enqueued).toBe(0);
  });

  it('ignores objects without created_at', async () => {
    const subject = treeDependencies({
      'apk-drafts:': [folder('operations')],
      'apk-drafts:operations/': [folder(DRAFT)],
      [`apk-drafts:operations/${DRAFT}/`]: [file('source.apk', null)],
    });

    const counters = await runCleanupSweep(subject);

    expect(subject.enqueueOrphan).not.toHaveBeenCalled();
    expect(counters.scanned).toBe(1);
  });

  it('ignores referenced objects', async () => {
    const subject = treeDependencies(draftTree, {
      isReferenced: vi.fn(async () => true),
    });

    const counters = await runCleanupSweep(subject);

    expect(subject.isReferenced).toHaveBeenCalledWith(
      'apk-drafts',
      `operations/${DRAFT}/source.apk`,
    );
    expect(subject.enqueueOrphan).not.toHaveBeenCalled();
    expect(counters.scanned).toBe(1);
    expect(counters.enqueued).toBe(0);
  });

  it('enqueues an old unreferenced object with its target type', async () => {
    const path = `apps/${APP}/icons/${FILE}.png`;
    const subject = treeDependencies({
      'app-assets:': [folder('apps')],
      'app-assets:apps/': [folder(APP)],
      [`app-assets:apps/${APP}/icons/`]: [file(`${FILE}.png`, 25 * 3_600_000)],
      [`app-assets:apps/${APP}/screenshots/`]: [],
    } as Tree, {
      loadCursor: vi.fn(async () => ({
        bucket: 'app-assets' as const,
        lastFolder: null,
      })),
    });

    const counters = await runCleanupSweep(subject);

    expect(subject.enqueueOrphan).toHaveBeenCalledWith({
      bucket: 'app-assets',
      path,
      targetType: 'icon',
      assetId: FILE,
      releaseId: null,
      catalogFile: null,
    });
    expect(counters.enqueued).toBe(1);
  });

  it('treats a null enqueue result as already queued', async () => {
    const subject = treeDependencies(draftTree, {
      enqueueOrphan: vi.fn(async () => null),
    });

    const counters = await runCleanupSweep(subject);

    expect(subject.enqueueOrphan).toHaveBeenCalledTimes(1);
    expect(counters.enqueued).toBe(0);
    expect(counters.scanned).toBe(1);
  });

  it('never removes storage objects', async () => {
    const subject = treeDependencies(draftTree);

    await runCleanupSweep(subject);

    expect('remove' in subject).toBe(false);
    expect(subject.list).toHaveBeenCalled();
    expect(subject.isReferenced).toHaveBeenCalled();
    expect(subject.enqueueOrphan).toHaveBeenCalled();
    expect(Object.keys(subject).sort()).toEqual([
      'enqueueOrphan',
      'isReferenced',
      'list',
      'loadCursor',
      'now',
      'saveCursor',
    ]);
  });

  it('continues from the saved cursor and skips earlier folders', async () => {
    const subject = treeDependencies({
      'apks:': [folder('apps')],
      'apks:apps/': [folder(APP), folder(APP2)],
      [`apks:apps/${APP}/versions/`]: [file(`${VERSION}.apk`, 30 * 3_600_000)],
      [`apks:apps/${APP2}/versions/`]: [file(`${VERSION2}.apk`, 30 * 3_600_000)],
    }, {
      loadCursor: vi.fn(async () => ({
        bucket: 'apks' as const,
        lastFolder: `apps/${APP}`,
      })),
    });

    await runCleanupSweep(subject);

    expect(subject.enqueueOrphan).toHaveBeenCalledTimes(1);
    expect(subject.enqueueOrphan).toHaveBeenCalledWith({
      bucket: 'apks',
      path: `apps/${APP2}/versions/${VERSION2}.apk`,
      targetType: 'apk',
      assetId: VERSION2,
      releaseId: null,
      catalogFile: null,
    });
  });

  it('resets the cursor when the bucket is exhausted', async () => {
    const subject = treeDependencies({
      'apks:': [folder('apps')],
      'apks:apps/': [folder(APP)],
      [`apks:apps/${APP}/versions/`]: [],
    }, {
      loadCursor: vi.fn(async () => ({ bucket: 'apks' as const, lastFolder: null })),
    });

    await runCleanupSweep(subject);

    expect(subject.saveCursor).toHaveBeenCalledTimes(1);
    expect(subject.saveCursor).toHaveBeenCalledWith({
      bucket: 'app-assets',
      lastFolder: null,
    });
  });

  it('advances to the next bucket and wraps to the first', async () => {
    const empty: Tree = {};
    const buckets: Record<string, string> = {
      'apk-drafts': 'apks',
      apks: 'app-assets',
      'app-assets': 'apk-drafts',
    };

    for (const [bucket, expected] of Object.entries(buckets)) {
      const subject = treeDependencies(empty, {
        loadCursor: vi.fn(async () => ({
          bucket: bucket as 'apk-drafts' | 'apks' | 'app-assets',
          lastFolder: null,
        })),
      });

      await runCleanupSweep(subject);

      expect(subject.saveCursor).toHaveBeenCalledWith({
        bucket: expected,
        lastFolder: null,
      });
    }
  });

  it('stops after the folder limit', async () => {
    const folders = Array.from({ length: 1_001 }, (_, index) =>
      folder(`app-${String(index).padStart(4, '0')}`),
    );
    const subject = treeDependencies({
      'apks:': [folder('apps')],
      'apks:apps/': folders,
    }, {
      loadCursor: vi.fn(async () => ({ bucket: 'apks' as const, lastFolder: null })),
    });

    const counters = await runCleanupSweep(subject);

    expect(counters.scanned).toBe(0);
    expect(subject.saveCursor).toHaveBeenCalledTimes(1);
    expect(subject.saveCursor).toHaveBeenCalledWith({
      bucket: 'apks',
      lastFolder: 'apps/app-0999',
    });
  });

  it('pages through folder listings with the offset', async () => {
    const list = vi.fn(async (_bucket: string, prefix: string, offset: number) => {
      if (prefix === '') return { entries: [folder('operations')], hasMore: false };
      if (prefix === 'operations/') {
        return { entries: [folder(DRAFT)], hasMore: false };
      }
      if (offset === 0) {
        return { entries: [file('source.apk', 30 * 3_600_000)], hasMore: true };
      }
      return { entries: [file('second.apk', 30 * 3_600_000)], hasMore: false };
    });
    const subject = treeDependencies({}, { list });

    const counters = await runCleanupSweep(subject);

    expect(list).toHaveBeenCalledWith('apk-drafts', `operations/${DRAFT}/`, 0);
    expect(list).toHaveBeenCalledWith('apk-drafts', `operations/${DRAFT}/`, 1);
    expect(counters.scanned).toBe(2);
    // second.apk is not a canonical draft path, so only source.apk is queued.
    expect(subject.enqueueOrphan).toHaveBeenCalledTimes(1);
  });
});
