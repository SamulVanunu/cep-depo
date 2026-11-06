import { describe, expect, it, vi } from 'vitest';

import {
  describeJobError,
  isLeaseLost,
  isMissingObject,
  runCleanupBatch,
  type CleanupJob,
  type CleanupWorkerDependencies,
} from './cleanup-worker';
import { managedTarget } from './cleanup-paths';
import {
  catalogReferenceKey,
  readCatalogReferenceKeys,
  type LiveCatalogClient,
} from './live-catalog';

const APP = 'b2000000-0000-4000-8000-000000000001';
const VERSION = 'b3000000-0000-4000-8000-000000000001';
const FILE = 'b4000000-0000-4000-8000-000000000001';
const DRAFT = 'b5000000-0000-4000-8000-000000000001';

function job(overrides: Partial<CleanupJob> = {}): CleanupJob {
  return {
    jobId: 'b1000000-0000-4000-8000-000000000001',
    bucket: 'apks',
    path: `apps/${APP}/versions/${VERSION}.apk`,
    targetType: 'apk',
    attempts: 0,
    leaseToken: 'b6000000-0000-4000-8000-000000000001',
    storageVersion: 'b7000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

function claimOnce(...jobs: CleanupJob[]) {
  return vi
    .fn<CleanupWorkerDependencies['claimJobs']>()
    .mockResolvedValueOnce(jobs)
    .mockResolvedValue([]);
}

function dependencies(
  overrides: Partial<CleanupWorkerDependencies> = {},
): CleanupWorkerDependencies {
  return {
    claimJobs: claimOnce(job()),
    startJob: vi.fn(async () => 1),
    isReferenced: vi.fn(async () => false),
    inspectObject: vi.fn(async () => ({
      state: 'present' as const,
      lastModified: null,
      version: 'b7000000-0000-4000-8000-000000000001',
    })),
    isCatalogReferenced: vi.fn(async () => false),
    isCatalogReleaseRetained: vi.fn(async () => false),
    removeObject: vi.fn(async () => ({ error: null, removed: true })),
    completeJob: vi.fn(async () => undefined),
    failJob: vi.fn<CleanupWorkerDependencies['failJob']>(async () => ({
      quarantined: false,
    })),
    skipJob: vi.fn<CleanupWorkerDependencies['skipJob']>(async () => 'skipped'),
    releaseJob: vi.fn(async () => undefined),
    ...overrides,
  };
}

function catalogClient(files: Record<string, string | null>): LiveCatalogClient {
  return {
    storage: {
      from: () => ({
        async download(path: string) {
          const body = files[path];
          if (typeof body === 'string') return { data: body, error: null };
          return {
            data: null,
            error: Object.assign(new Error('Object not found'), { status: 400 }),
          };
        },
      }),
    },
  };
}

// Wires the real live-catalog reader into the worker so the catalog-reference
// guard is exercised end to end instead of being stubbed.
function catalogDependencies(
  files: Record<string, string | null>,
  overrides: Partial<CleanupWorkerDependencies> = {},
): CleanupWorkerDependencies {
  const client = catalogClient(files);
  return dependencies({
    isCatalogReferenced: async (bucket, path) => {
      if (bucket === 'apk-drafts') return false;
      const keys = await readCatalogReferenceKeys(client, {
        sources: {
          pointer: async () => ({
            generation: 0,
            releaseId: null,
            retainedFromGeneration: 0,
            reconciliationRequired: false,
          }),
          retainedReleases: async () => [],
          releaseExists: async () => true,
        },
      });
      return keys.has(catalogReferenceKey(bucket, path));
    },
    ...overrides,
  });
}

function legacyApps(entries: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-11-04T12:00:00.000Z',
    apps: entries,
  });
}

describe('isLeaseLost', () => {
  it('recognises the CLN01 SQLSTATE in each shape supabase returns', () => {
    expect(isLeaseLost({ code: 'CLN01' })).toBe(true);
    expect(isLeaseLost(new Error('CLN01: lease is not yours'))).toBe(true);
    expect(isLeaseLost({ code: 'P0001' })).toBe(false);
    expect(isLeaseLost(null)).toBe(false);
    expect(isLeaseLost('boom')).toBe(false);
  });
});

describe('isMissingObject', () => {
  it('recognises a missing storage object and nothing else', () => {
    expect(isMissingObject({ statusCode: 404 })).toBe(true);
    expect(isMissingObject({ status: 404 })).toBe(true);
    expect(isMissingObject({ code: 'not_found' })).toBe(true);
    expect(isMissingObject({ status: 400, message: 'Object not found' })).toBe(true);
    expect(isMissingObject(new Error('Object not found'))).toBe(true);
    expect(isMissingObject({ statusCode: 500 })).toBe(false);
    expect(isMissingObject(new Error('network down'))).toBe(false);
    expect(isMissingObject(null)).toBe(false);
  });
});

describe('describeJobError', () => {
  it('redacts URL query strings and clips to 500 characters', () => {
    const described = describeJobError(
      new Error(`upload failed https://example.test/a?token=secret&x=1 ${'z'.repeat(600)}`),
    );

    expect(described).not.toContain('token=secret');
    expect(described).toContain('https://example.test/a?[redacted]');
    expect(described.length).toBe(500);
  });

  it('never returns an empty description', () => {
    expect(describeJobError(null)).toBe('Bilinmeyen hata');
    expect(describeJobError(undefined)).toBe('Bilinmeyen hata');
    expect(describeJobError({})).toBe('Bilinmeyen hata');
  });
});

describe('managedTarget', () => {
  it('derives the asset id for every managed shape', () => {
    expect(
      managedTarget('apk-drafts', `operations/${DRAFT}/source.apk`, 'apk_draft'),
    ).toEqual({
      bucket: 'apk-drafts',
      path: `operations/${DRAFT}/source.apk`,
      targetType: 'apk_draft',
      assetId: DRAFT,
      releaseId: null,
      catalogFile: null,
    });
    expect(managedTarget('apks', job().path, 'apk')?.assetId).toBe(VERSION);
    expect(
      managedTarget('app-assets', `apps/${APP}/icons/${FILE}.png`, 'icon')?.assetId,
    ).toBe(FILE);
    expect(
      managedTarget('app-assets', `apps/${APP}/screenshots/${FILE}.webp`, 'screenshot')
        ?.assetId,
    ).toBe(FILE);
  });

  it('rejects a bucket that does not own the target type', () => {
    expect(managedTarget('apks', `apps/${APP}/icons/${FILE}.png`, 'icon')).toBeNull();
    expect(managedTarget('app-assets', job().path, 'apk')).toBeNull();
  });
});

describe('runCleanupBatch', () => {
  it('skips a referenced path without removing it', async () => {
    const subject = dependencies({ isReferenced: vi.fn(async () => true) });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.isReferenced).toHaveBeenCalledWith('apks', job().path);
    expect(subject.skipJob).toHaveBeenCalledWith(job().jobId, 'w1', 'referenced');
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(counters).toEqual({
      claimed: 1,
      completed: 0,
      skippedReferenced: 1,
      skippedOwnership: 0,
      quarantined: 0,
      failed: 0,
      leaseLost: 0,
      released: 0,
    });
  });

  it('removes an unreferenced object and completes after re-check', async () => {
    const subject = dependencies();

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.isReferenced).toHaveBeenCalledTimes(2);
    expect(subject.isReferenced).toHaveBeenNthCalledWith(1, 'apks', job().path);
    expect(subject.isReferenced).toHaveBeenNthCalledWith(2, 'apks', job().path);
    expect(subject.removeObject).toHaveBeenCalledWith(
      'apks',
      job().path,
      job().storageVersion,
    );
    expect(subject.completeJob).toHaveBeenCalledWith(job().jobId, 'w1');
    expect(counters.completed).toBe(1);
    expect(counters.failed).toBe(0);
  });

  it('deletes only the object version captured when the job was enqueued', async () => {
    const subject = dependencies();

    await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).toHaveBeenCalledWith(
      'apks',
      job().path,
      'b7000000-0000-4000-8000-000000000001',
    );
    expect(subject.completeJob).toHaveBeenCalledWith(job().jobId, 'w1');
  });

  it('does not remove an APK still referenced by the live catalog', async () => {
    const subject = dependencies({
      isCatalogReferenced: vi.fn(async () => true),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.isCatalogReferenced).toHaveBeenCalledWith('apks', job().path);
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('katalog'),
    );
    expect(counters.failed).toBe(1);
  });

  it('fails closed when the live catalog cannot be read', async () => {
    const subject = dependencies({
      isCatalogReferenced: vi.fn(async () => {
        throw new Error('catalog read failed');
      }),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('catalog read failed'),
    );
    expect(counters.failed).toBe(1);
  });

  it('does not remove an APK referenced by the legacy root apps.json', async () => {
    const target = job();
    const subject = catalogDependencies({
      'manifest.json': null,
      'apps.json': legacyApps([{ apk_path: target.path }]),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      target.jobId,
      'w1',
      expect.stringContaining('katalog'),
    );
    expect(counters.failed).toBe(1);
  });

  it('does not remove an icon referenced by the legacy root apps.json', async () => {
    const iconPath = `apps/${APP}/icons/${FILE}.png`;
    const icon = job({
      bucket: 'app-assets',
      path: iconPath,
      targetType: 'icon',
    });
    const subject = catalogDependencies(
      {
        'manifest.json': null,
        'apps.json': legacyApps([{ icon_path: iconPath }]),
      },
      { claimJobs: claimOnce(icon) },
    );

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      icon.jobId,
      'w1',
      expect.stringContaining('katalog'),
    );
    expect(counters.failed).toBe(1);
  });

  it('fails closed when the legacy root apps.json is broken', async () => {
    const target = job();
    const subject = catalogDependencies({
      'manifest.json': null,
      'apps.json': '{not json',
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      target.jobId,
      'w1',
      expect.stringMatching(/JSON/i),
    );
    expect(counters.failed).toBe(1);
  });

  it('protects an icon through the same live catalog reference check', async () => {
    const icon = job({
      bucket: 'app-assets',
      path: `apps/${APP}/icons/${FILE}.png`,
      targetType: 'icon',
    });
    const subject = dependencies({
      claimJobs: claimOnce(icon),
      isCatalogReferenced: vi.fn(async () => true),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.isCatalogReferenced).toHaveBeenCalledWith('app-assets', icon.path);
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(counters.failed).toBe(1);
  });

  it('does not consult the live catalog for apk drafts', async () => {
    const draft = job({
      bucket: 'apk-drafts',
      path: `operations/${DRAFT}/source.apk`,
      targetType: 'apk_draft',
    });
    const subject = dependencies({ claimJobs: claimOnce(draft) });

    await runCleanupBatch(subject, 'w1');

    expect(subject.isCatalogReferenced).not.toHaveBeenCalled();
    expect(subject.removeObject).toHaveBeenCalledWith(
      'apk-drafts',
      draft.path,
      draft.storageVersion,
    );
  });

  it('refuses to delete a present object that has no enqueue-time fingerprint', async () => {
    const subject = dependencies({
      claimJobs: claimOnce(job({ storageVersion: null })),
      inspectObject: vi.fn(async () => ({
        state: 'present' as const,
        lastModified: null,
        version: 'b7000000-0000-4000-8000-000000000099',
      })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.inspectObject).toHaveBeenCalledWith('apks', job().path);
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('oluşturulmuş'),
    );
    expect(counters.failed).toBe(1);
  });

  it('fails closed when a no-fingerprint object probe is unknown', async () => {
    const subject = dependencies({
      claimJobs: claimOnce(job({ storageVersion: null })),
      inspectObject: vi.fn(async () => ({
        state: 'unknown' as const,
        lastModified: null,
        version: null,
      })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('doğrulanamadı'),
    );
    expect(counters.failed).toBe(1);
  });

  it('completes a no-fingerprint job when the object is already gone', async () => {
    const subject = dependencies({
      claimJobs: claimOnce(job({ storageVersion: null })),
      inspectObject: vi.fn(async () => ({
        state: 'missing' as const,
        lastModified: null,
        version: null,
      })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).toHaveBeenCalledWith(job().jobId, 'w1');
    expect(counters.completed).toBe(1);
  });

  it('completes when the stored version no longer exists without deleting a replacement', async () => {
    const subject = dependencies({
      removeObject: vi.fn(async () => ({ error: null, removed: false })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).toHaveBeenCalledWith(
      'apks',
      job().path,
      job().storageVersion,
    );
    expect(subject.completeJob).toHaveBeenCalledWith(job().jobId, 'w1');
    expect(counters.completed).toBe(1);
  });

  it('completes when the object is already gone', async () => {
    const subject = dependencies({
      removeObject: vi.fn(async () => ({ error: { statusCode: 404 }, removed: false })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.failJob).not.toHaveBeenCalled();
    expect(subject.completeJob).toHaveBeenCalledWith(job().jobId, 'w1');
    expect(counters.completed).toBe(1);
    expect(counters.failed).toBe(0);
  });

  it('fails the job and does not complete when remove errors', async () => {
    const subject = dependencies({
      removeObject: vi.fn(async () => ({ error: new Error('storage exploded'), removed: false })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('storage exploded'),
    );
    expect(counters.failed).toBe(1);
    expect(counters.quarantined).toBe(0);
  });

  it('quarantines a job on the fifth failed attempt instead of counting a failure', async () => {
    const subject = dependencies({
      removeObject: vi.fn(async () => ({ error: new Error('storage exploded'), removed: false })),
      failJob: vi.fn<CleanupWorkerDependencies['failJob']>(async () => ({
        quarantined: true,
      })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.failJob).toHaveBeenCalledTimes(1);
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(counters.quarantined).toBe(1);
    expect(counters.failed).toBe(0);
  });

  it('counts CLN01 from failJob as lease lost, not failed', async () => {
    const subject = dependencies({
      removeObject: vi.fn(async () => ({ error: new Error('storage exploded'), removed: false })),
      failJob: vi.fn<CleanupWorkerDependencies['failJob']>(async () => {
        throw { code: 'CLN01', message: 'lease lost' };
      }),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(counters.leaseLost).toBe(1);
    expect(counters.failed).toBe(0);
    expect(counters.quarantined).toBe(0);
  });

  it('skips with race_detected when a reference reappears after delete', async () => {
    const isReferenced = vi
      .fn<CleanupWorkerDependencies['isReferenced']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const subject = dependencies({
      isReferenced,
      skipJob: vi.fn<CleanupWorkerDependencies['skipJob']>(
        async () => 'quarantined',
      ),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.skipJob).toHaveBeenCalledWith(job().jobId, 'w1', 'race_detected');
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(counters.quarantined).toBe(1);
    expect(counters.skippedReferenced).toBe(0);
    expect(counters.skippedOwnership).toBe(0);
    expect(counters.failed).toBe(0);
  });

  it('counts a gate-quarantined referenced job as quarantined, not skipped', async () => {
    const subject = dependencies({
      isReferenced: vi.fn(async () => true),
      skipJob: vi.fn<CleanupWorkerDependencies['skipJob']>(
        async () => 'quarantined',
      ),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.skipJob).toHaveBeenCalledWith(job().jobId, 'w1', 'referenced');
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(counters.quarantined).toBe(1);
    expect(counters.skippedReferenced).toBe(0);
    expect(counters.failed).toBe(0);
  });

  it('treats an unrecognised skip result as an error instead of success', async () => {
    const subject = dependencies({
      isReferenced: vi.fn(async () => true),
      skipJob: vi.fn<CleanupWorkerDependencies['skipJob']>(
        async () => undefined as unknown as 'skipped',
      ),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('Beklenmeyen atlama sonucu'),
    );
    expect(counters.completed).toBe(0);
  });

  it('rejects a bucket outside the allowlist', async () => {
    const subject = dependencies({
      claimJobs: claimOnce(
        job({ bucket: 'avatars', path: 'avatars/x/y.png', targetType: 'icon' }),
      ),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.skipJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      'ownership_mismatch',
    );
    expect(subject.isReferenced).not.toHaveBeenCalled();
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(counters.skippedOwnership).toBe(1);
  });

  it('rejects a non-canonical path', async () => {
    const subject = dependencies({
      claimJobs: claimOnce(job({ path: '../x' })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.skipJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      'ownership_mismatch',
    );
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(counters.skippedOwnership).toBe(1);
  });

  it('counts CLN01 as lease lost, not failed', async () => {
    const subject = dependencies({
      completeJob: vi.fn(async () => {
        throw { code: 'CLN01', message: 'lease lost' };
      }),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(counters.leaseLost).toBe(1);
    expect(counters.failed).toBe(0);
    expect(subject.failJob).not.toHaveBeenCalled();
  });

  it('keeps processing when one job throws', async () => {
    const second = job({
      jobId: 'b1000000-0000-4000-8000-000000000002',
      path: `apps/${APP}/versions/b3000000-0000-4000-8000-000000000002.apk`,
    });
    const removeObject = vi
      .fn<CleanupWorkerDependencies['removeObject']>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ error: null, removed: true });
    const subject = dependencies({
      claimJobs: claimOnce(job(), second),
      removeObject,
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('socket hang up'),
    );
    expect(subject.completeJob).toHaveBeenCalledWith(second.jobId, 'w1');
    expect(counters.failed).toBe(1);
    expect(counters.completed).toBe(1);
  });

  it('starts a claimed job before touching Storage', async () => {
    const subject = dependencies();

    await runCleanupBatch(subject, 'w1');

    expect(subject.startJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      job().leaseToken,
    );
    const startOrder = vi.mocked(subject.startJob).mock.invocationCallOrder[0];
    const referenceOrder = vi.mocked(subject.isReferenced).mock.invocationCallOrder[0];
    expect(startOrder).toBeLessThan(referenceOrder);
  });

  it('claims only the wave the usable budget can finish', async () => {
    const claimJobs = claimOnce(job());
    const subject = dependencies({ claimJobs, now: () => 0 });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(claimJobs).toHaveBeenNthCalledWith(1, {
      workerId: 'w1',
      limit: 1,
      leaseSeconds: 120,
    });
    expect(counters.claimed).toBe(1);
  });

  it('claims nothing when less than one job budget remains', async () => {
    let calls = 0;
    const claimJobs = vi.fn<CleanupWorkerDependencies['claimJobs']>();
    const subject = dependencies({
      claimJobs,
      now: () => (calls++ === 0 ? 0 : 18_000),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(claimJobs).not.toHaveBeenCalled();
    expect(counters).toEqual({
      claimed: 0,
      completed: 0,
      skippedReferenced: 0,
      skippedOwnership: 0,
      quarantined: 0,
      failed: 0,
      leaseLost: 0,
      released: 0,
    });
  });

  it('keeps claiming a new wave while the usable budget remains', async () => {
    const first = job();
    const second = job({
      jobId: 'b1000000-0000-4000-8000-000000000002',
      path: `apps/${APP}/versions/b3000000-0000-4000-8000-000000000002.apk`,
      leaseToken: 'b6000000-0000-4000-8000-000000000002',
    });
    let claimCalls = 0;
    const claimJobs = vi.fn<CleanupWorkerDependencies['claimJobs']>(async () => {
      claimCalls += 1;
      if (claimCalls === 1) return [first];
      if (claimCalls === 2) return [second];
      return [];
    });
    const subject = dependencies({
      claimJobs,
      now: () => (claimCalls >= 2 ? 1_000 : 0),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(claimJobs).toHaveBeenCalledTimes(3);
    expect(counters.claimed).toBe(2);
    expect(counters.completed).toBe(2);
  });

  it('releases claims the budget left unstarted without consuming their attempt', async () => {
    const jobs = [
      job(),
      job({
        jobId: 'b1000000-0000-4000-8000-000000000002',
        path: `apps/${APP}/versions/b3000000-0000-4000-8000-000000000002.apk`,
        leaseToken: 'b6000000-0000-4000-8000-000000000002',
      }),
      job({
        jobId: 'b1000000-0000-4000-8000-000000000003',
        path: `apps/${APP}/versions/b3000000-0000-4000-8000-000000000003.apk`,
        leaseToken: 'b6000000-0000-4000-8000-000000000003',
      }),
    ];
    let now = 0;
    let removals = 0;
    const removeObject = vi.fn<CleanupWorkerDependencies['removeObject']>(
      async () => {
        removals += 1;
        if (removals === 2) now = 18_000;
        return { error: null, removed: true };
      },
    );
    const subject = dependencies({
      claimJobs: claimOnce(...jobs),
      removeObject,
      now: () => now,
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.startJob).toHaveBeenCalledTimes(2);
    expect(subject.releaseJob).toHaveBeenCalledTimes(1);
    expect(subject.releaseJob).toHaveBeenCalledWith(
      jobs[2].jobId,
      'w1',
      jobs[2].leaseToken,
    );
    expect(counters.completed).toBe(2);
    expect(counters.released).toBe(1);
  });

  it('terminalizes a started job instead of releasing it when its budget expires', async () => {
    let now = 0;
    const startJob = vi.fn(async () => {
      now = 15_000;
      return 1;
    });
    const subject = dependencies({ startJob, now: () => now });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.releaseJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      expect.stringContaining('İş bütçesi aşıldı'),
    );
    expect(counters.released).toBe(0);
    expect(counters.failed).toBe(1);
  });

  it('releases a claim when start fails without a lease loss', async () => {
    const subject = dependencies({
      startJob: vi.fn(async () => {
        throw new Error('rpc timeout');
      }),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.releaseJob).toHaveBeenCalledWith(
      job().jobId,
      'w1',
      job().leaseToken,
    );
    expect(subject.isReferenced).not.toHaveBeenCalled();
    expect(counters.released).toBe(1);
    expect(counters.failed).toBe(0);
  });

  it('counts a lease-lost start as lease lost without releasing', async () => {
    const subject = dependencies({
      startJob: vi.fn(async () => {
        throw { code: 'CLN01', message: 'lease lost' };
      }),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.releaseJob).not.toHaveBeenCalled();
    expect(counters.leaseLost).toBe(1);
  });

  it('returns zero counters for an empty batch', async () => {
    const subject = dependencies({ claimJobs: vi.fn(async () => []) });

    await expect(runCleanupBatch(subject, 'w1')).resolves.toEqual({
      claimed: 0,
      completed: 0,
      skippedReferenced: 0,
      skippedOwnership: 0,
      quarantined: 0,
      failed: 0,
      leaseLost: 0,
      released: 0,
    });
    expect(subject.isReferenced).not.toHaveBeenCalled();
  });

  it('passes the worker id to claim, complete and fail', async () => {
    const removeObject = vi
      .fn<CleanupWorkerDependencies['removeObject']>()
      .mockResolvedValueOnce({ error: null, removed: true })
      .mockResolvedValueOnce({ error: new Error('nope'), removed: false });
    const second = job({
      jobId: 'b1000000-0000-4000-8000-000000000003',
      path: `apps/${APP}/versions/b3000000-0000-4000-8000-000000000003.apk`,
    });
    const subject = dependencies({
      claimJobs: claimOnce(job(), second),
      removeObject,
    });

    await runCleanupBatch(subject, 'cleanup-test-abc');

    expect(subject.claimJobs).toHaveBeenCalledWith({
      workerId: 'cleanup-test-abc',
      limit: 1,
      leaseSeconds: 120,
    });
    expect(subject.startJob).toHaveBeenCalledWith(
      job().jobId,
      'cleanup-test-abc',
      job().leaseToken,
    );
    expect(subject.completeJob).toHaveBeenCalledWith(job().jobId, 'cleanup-test-abc');
    expect(subject.failJob).toHaveBeenCalledWith(
      second.jobId,
      'cleanup-test-abc',
      expect.any(String),
    );
  });
});

describe('runCleanupBatch catalog documents', () => {
  const RELEASE = 'rel_12345678';
  const catalogPath = `releases/${RELEASE}/apps.json`;
  const catalogJobId = 'b1000000-0000-4000-8000-000000000002';
  const catalogLease = 'b6000000-0000-4000-8000-000000000002';
  const catalogVersion = 'b7000000-0000-4000-8000-000000000002';

  function catalogJob(overrides: Partial<CleanupJob> = {}): CleanupJob {
    return job({
      jobId: catalogJobId,
      bucket: 'catalog',
      path: catalogPath,
      targetType: 'catalog_document',
      leaseToken: catalogLease,
      storageVersion: catalogVersion,
      ...overrides,
    });
  }

  function catalogDependencies(
    overrides: Partial<CleanupWorkerDependencies> = {},
    jobOverrides: Partial<CleanupJob> = {},
  ): CleanupWorkerDependencies {
    return dependencies({
      claimJobs: claimOnce(catalogJob(jobOverrides)),
      ...overrides,
    });
  }

  it('removes an eligible catalog document through the same versioned delete path', async () => {
    const subject = catalogDependencies();

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.startJob).toHaveBeenCalledWith(catalogJobId, 'w1', catalogLease);
    expect(subject.isReferenced).toHaveBeenNthCalledWith(1, 'catalog', catalogPath);
    expect(subject.isCatalogReleaseRetained).toHaveBeenCalledWith(RELEASE);
    expect(subject.isCatalogReferenced).not.toHaveBeenCalled();
    expect(subject.removeObject).toHaveBeenCalledTimes(1);
    expect(subject.removeObject).toHaveBeenCalledWith(
      'catalog',
      catalogPath,
      catalogVersion,
    );
    expect(subject.isReferenced).toHaveBeenNthCalledWith(2, 'catalog', catalogPath);
    expect(subject.completeJob).toHaveBeenCalledWith(catalogJobId, 'w1');
    expect(counters.completed).toBe(1);
    expect(counters.failed).toBe(0);
    expect(counters.skippedReferenced).toBe(0);
  });

  it('skips a catalog document the SQL seal still protects', async () => {
    const subject = catalogDependencies({
      isReferenced: vi.fn(async () => true),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.skipJob).toHaveBeenCalledWith(catalogJobId, 'w1', 'referenced');
    expect(subject.isCatalogReleaseRetained).not.toHaveBeenCalled();
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(counters.skippedReferenced).toBe(1);
  });

  it('skips a catalog document the independent retention check protects', async () => {
    const subject = catalogDependencies({
      isCatalogReleaseRetained: vi.fn(async () => true),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.isCatalogReleaseRetained).toHaveBeenCalledWith(RELEASE);
    expect(subject.skipJob).toHaveBeenCalledWith(catalogJobId, 'w1', 'referenced');
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(counters.skippedReferenced).toBe(1);
  });

  it('never routes a catalog document through the live catalog key check', async () => {
    const subject = catalogDependencies();

    await runCleanupBatch(subject, 'w1');

    expect(subject.isCatalogReferenced).not.toHaveBeenCalled();
    expect(subject.isCatalogReleaseRetained).toHaveBeenCalledTimes(1);
  });

  it('fails a catalog job whose row cannot be validated instead of freeing the path', async () => {
    const subject = catalogDependencies(
      {},
      { path: `releases/${RELEASE}/manifest.json` },
    );

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.skipJob).not.toHaveBeenCalled();
    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      catalogJobId,
      'w1',
      expect.stringContaining('Katalog'),
    );
    expect(counters.failed).toBe(1);
    expect(counters.skippedOwnership).toBe(0);
  });

  it('completes a catalog job whose object was already gone when enqueued', async () => {
    const subject = catalogDependencies(
      {
        inspectObject: vi.fn(async () => ({
          state: 'missing' as const,
          lastModified: null,
          version: null,
        })),
      },
      { storageVersion: null },
    );

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).toHaveBeenCalledWith(catalogJobId, 'w1');
    expect(counters.completed).toBe(1);
  });

  it('fails a catalog job with no fingerprint whose object is present', async () => {
    const subject = catalogDependencies({}, { storageVersion: null });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.removeObject).not.toHaveBeenCalled();
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      catalogJobId,
      'w1',
      expect.any(String),
    );
    expect(counters.failed).toBe(1);
  });

  it('fails a catalog job when the conditional delete errors', async () => {
    const subject = catalogDependencies({
      removeObject: vi.fn(async () => ({
        error: new Error('storage denied'),
        removed: false,
      })),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).toHaveBeenCalledWith(
      catalogJobId,
      'w1',
      expect.any(String),
    );
    expect(counters.failed).toBe(1);
  });

  it('quarantines a catalog race so the path is not reported completed', async () => {
    const subject = catalogDependencies({
      isReferenced: vi
        .fn<CleanupWorkerDependencies['isReferenced']>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      skipJob: vi.fn<CleanupWorkerDependencies['skipJob']>(
        async () => 'quarantined',
      ),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.skipJob).toHaveBeenCalledWith(catalogJobId, 'w1', 'race_detected');
    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(counters.quarantined).toBe(1);
  });

  it('counts a lease lost catalog delete without completing', async () => {
    const subject = catalogDependencies({
      removeObject: vi.fn(async () => {
        throw Object.assign(new Error('lease lost'), { code: 'CLN01' });
      }),
    });

    const counters = await runCleanupBatch(subject, 'w1');

    expect(subject.completeJob).not.toHaveBeenCalled();
    expect(subject.failJob).not.toHaveBeenCalled();
    expect(counters.leaseLost).toBe(1);
  });
});
