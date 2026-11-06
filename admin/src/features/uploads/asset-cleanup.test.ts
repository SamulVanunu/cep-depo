import { describe, expect, it, vi } from 'vitest';

import {
  enqueueCleanupAssets,
  type CleanupAsset,
  type CleanupDependencies,
} from './asset-cleanup';
import type { CleanupEnqueueResult } from './cleanup-enqueue';
import { assetIdFromDraftPath } from './cleanup-paths';

const asset: CleanupAsset = {
  bucket: 'apks',
  path: 'apps/a2000000-0000-4000-8000-000000000001/versions/a3000000-0000-4000-8000-000000000001.apk',
  assetId: 'a3000000-0000-4000-8000-000000000001',
  targetType: 'apk',
};

const queuedNew: CleanupEnqueueResult = {
  queued: true,
  deduped: false,
  audit: 'recorded',
  enqueueError: null,
  auditError: null,
};

function dependencies(
  enqueue: (asset: CleanupAsset) => Promise<CleanupEnqueueResult> = async () => queuedNew,
): CleanupDependencies {
  return { enqueue: vi.fn(enqueue) };
}

describe('enqueueCleanupAssets', () => {
  it('queues a validated managed object instead of deleting it', async () => {
    const subject = dependencies();

    await expect(enqueueCleanupAssets([asset], subject)).resolves.toEqual({
      queued: 1,
      alreadyQueued: 0,
      enqueueFailures: 0,
      auditFailures: 0,
    });
    expect(subject.enqueue).toHaveBeenCalledWith(asset);
  });

  it('queues every managed bucket and canonical target path', async () => {
    const subject = dependencies();
    const assets: CleanupAsset[] = [
      {
        bucket: 'apk-drafts',
        path: 'operations/a4000000-0000-4000-8000-000000000001/source.apk',
        assetId: 'a4000000-0000-4000-8000-000000000001',
        targetType: 'apk_draft',
      },
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/icons/a5000000-0000-4000-8000-000000000001.png',
        assetId: 'a5000000-0000-4000-8000-000000000001',
        targetType: 'icon',
      },
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/screenshots/a5000000-0000-4000-8000-000000000002.webp',
        assetId: 'a5000000-0000-4000-8000-000000000002',
        targetType: 'screenshot',
      },
    ];

    await expect(enqueueCleanupAssets(assets, subject)).resolves.toEqual({
      queued: 3,
      alreadyQueued: 0,
      enqueueFailures: 0,
      auditFailures: 0,
    });
    expect(subject.enqueue).toHaveBeenCalledTimes(3);
  });

  it('counts an object that was already queued as queued without a second queue row', async () => {
    const subject = dependencies(async () => ({
      queued: true,
      deduped: true,
      audit: 'already_recorded',
      enqueueError: null,
      auditError: null,
    }));

    await expect(enqueueCleanupAssets([asset], subject)).resolves.toEqual({
      queued: 1,
      alreadyQueued: 1,
      enqueueFailures: 0,
      auditFailures: 0,
    });
  });

  it('reports an enqueue failure without claiming the object is queued', async () => {
    const subject = dependencies(async () => ({
      queued: false,
      deduped: false,
      audit: 'not_attempted',
      enqueueError: { code: '42501' },
      auditError: null,
    }));

    await expect(enqueueCleanupAssets([asset], subject)).resolves.toEqual({
      queued: 0,
      alreadyQueued: 0,
      enqueueFailures: 1,
      auditFailures: 0,
    });
  });

  it('keeps a queued object out of the enqueue-failure count when the audit fails', async () => {
    const subject = dependencies(async () => ({
      queued: true,
      deduped: false,
      audit: 'failed',
      enqueueError: null,
      auditError: { code: 'P0001' },
    }));

    await expect(enqueueCleanupAssets([asset], subject)).resolves.toEqual({
      queued: 1,
      alreadyQueued: 0,
      enqueueFailures: 0,
      auditFailures: 1,
    });
  });

  it('keeps processing every asset after a rejected enqueue', async () => {
    const assets: CleanupAsset[] = [
      asset,
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/icons/a5000000-0000-4000-8000-000000000001.png',
        assetId: 'a5000000-0000-4000-8000-000000000001',
        targetType: 'icon',
      },
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/screenshots/a5000000-0000-4000-8000-000000000002.webp',
        assetId: 'a5000000-0000-4000-8000-000000000002',
        targetType: 'screenshot',
      },
      {
        bucket: 'apk-drafts',
        path: 'operations/a4000000-0000-4000-8000-000000000002/source.apk',
        assetId: 'a4000000-0000-4000-8000-000000000002',
        targetType: 'apk_draft',
      },
    ];
    const subject = dependencies(
      vi.fn()
        .mockRejectedValueOnce(new Error('queue rejected'))
        .mockResolvedValueOnce({
          queued: true,
          deduped: true,
          audit: 'already_recorded',
          enqueueError: null,
          auditError: null,
        })
        .mockResolvedValueOnce({
          queued: false,
          deduped: false,
          audit: 'not_attempted',
          enqueueError: { code: 'P0001' },
          auditError: null,
        })
        .mockResolvedValueOnce({
          queued: true,
          deduped: false,
          audit: 'failed',
          enqueueError: null,
          auditError: { code: 'P0001' },
        }),
    );

    await expect(enqueueCleanupAssets(assets, subject)).resolves.toEqual({
      queued: 2,
      alreadyQueued: 1,
      enqueueFailures: 2,
      auditFailures: 1,
    });
    expect(subject.enqueue).toHaveBeenCalledTimes(4);
  });

  it.each([
    {
      ...asset,
      path: 'https://downloads.example.com/app.apk',
    },
    {
      ...asset,
      path: '../unrelated.apk',
    },
    {
      ...asset,
      bucket: 'avatars' as 'apks',
    },
    {
      ...asset,
      assetId: 'not-a-uuid',
    },
  ])('rejects external or arbitrary cleanup identity %# before enqueueing', async invalid => {
    const subject = dependencies();

    await expect(enqueueCleanupAssets([invalid], subject)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(subject.enqueue).not.toHaveBeenCalled();
  });

  it('validates the complete batch before enqueueing any object', async () => {
    const subject = dependencies();

    await expect(enqueueCleanupAssets([
      asset,
      { ...asset, path: 'https://downloads.example.com/app.apk' },
    ], subject)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(subject.enqueue).not.toHaveBeenCalled();
  });
});

describe('assetIdFromDraftPath', () => {
  it('derives the asset id from a canonical draft path', () => {
    expect(
      assetIdFromDraftPath('operations/a4000000-0000-4000-8000-000000000001/source.apk'),
    ).toBe('a4000000-0000-4000-8000-000000000001');
    expect(assetIdFromDraftPath('../x')).toBeNull();
    expect(
      assetIdFromDraftPath('operations/a4000000-0000-4000-8000-000000000001/other.apk'),
    ).toBeNull();
  });
});
