import { describe, expect, it, vi } from 'vitest';

import {
  removeOrEnqueueAssets,
  type CleanupAsset,
  type CleanupDependencies,
} from './asset-cleanup';

const asset: CleanupAsset = {
  bucket: 'apks',
  path: 'apps/a2000000-0000-4000-8000-000000000001/versions/a3000000-0000-4000-8000-000000000001.apk',
  operationId: 'a3000000-0000-4000-8000-000000000001',
  targetType: 'apk',
};

function dependencies(overrides: Partial<CleanupDependencies> = {}): CleanupDependencies {
  return {
    remove: vi.fn(async () => ({ error: null })),
    enqueue: vi.fn(async () => ({ error: null })),
    complete: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('removeOrEnqueueAssets', () => {
  it('removes a validated managed object and completes its durable job', async () => {
    const subject = dependencies();

    await expect(removeOrEnqueueAssets([asset], subject)).resolves.toEqual({ pending: 0 });
    expect(subject.remove).toHaveBeenCalledWith('apks', asset.path);
    expect(subject.enqueue).not.toHaveBeenCalled();
    expect(subject.complete).toHaveBeenCalledWith(asset);
  });

  it('accepts every managed bucket and canonical target path', async () => {
    const subject = dependencies();
    const assets: CleanupAsset[] = [
      {
        bucket: 'apk-drafts',
        path: 'operations/a4000000-0000-4000-8000-000000000001/source.apk',
        operationId: 'a4000000-0000-4000-8000-000000000001',
        targetType: 'apk_draft',
      },
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/icons/a5000000-0000-4000-8000-000000000001.png',
        operationId: 'a4000000-0000-4000-8000-000000000002',
        targetType: 'icon',
      },
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/screenshots/a5000000-0000-4000-8000-000000000002.webp',
        operationId: 'a4000000-0000-4000-8000-000000000003',
        targetType: 'screenshot',
      },
    ];

    await expect(removeOrEnqueueAssets(assets, subject)).resolves.toEqual({ pending: 0 });
    expect(subject.remove).toHaveBeenCalledTimes(3);
  });

  it('queues exactly one service cleanup job when removal fails', async () => {
    const subject = dependencies({
      remove: vi.fn(async () => ({ error: new Error('storage failure https://secret') })),
    });

    await expect(removeOrEnqueueAssets([asset], subject)).resolves.toEqual({ pending: 1 });
    expect(subject.enqueue).toHaveBeenCalledOnce();
    expect(subject.enqueue).toHaveBeenCalledWith(asset);
    expect(subject.complete).not.toHaveBeenCalled();
  });

  it('treats a pending unique conflict as an idempotent queued cleanup', async () => {
    const subject = dependencies({
      remove: vi.fn(async () => ({ error: new Error('failed') })),
      enqueue: vi.fn(async () => ({ error: { code: '23505' } })),
    });

    await expect(removeOrEnqueueAssets([asset], subject)).resolves.toEqual({ pending: 1 });
    expect(subject.enqueue).toHaveBeenCalledOnce();
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
      operationId: 'not-a-uuid',
    },
  ])('rejects external or arbitrary cleanup identity %# before deletion', async invalid => {
    const subject = dependencies();

    await expect(removeOrEnqueueAssets([invalid], subject)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(subject.remove).not.toHaveBeenCalled();
    expect(subject.enqueue).not.toHaveBeenCalled();
  });

  it('validates the complete batch before deleting any object', async () => {
    const subject = dependencies();

    await expect(removeOrEnqueueAssets([
      asset,
      { ...asset, path: 'https://downloads.example.com/app.apk' },
    ], subject)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('keeps processing every asset when removal, enqueue, or completion fails', async () => {
    const assets: CleanupAsset[] = [
      asset,
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/icons/a5000000-0000-4000-8000-000000000001.png',
        operationId: 'a5000000-0000-4000-8000-000000000001',
        targetType: 'icon',
      },
      {
        bucket: 'app-assets',
        path: 'apps/a2000000-0000-4000-8000-000000000001/screenshots/a5000000-0000-4000-8000-000000000002.webp',
        operationId: 'a5000000-0000-4000-8000-000000000002',
        targetType: 'screenshot',
      },
    ];
    const subject = dependencies({
      remove: vi.fn()
        .mockRejectedValueOnce(new Error('remove rejected'))
        .mockResolvedValueOnce({ error: new Error('remove failed') })
        .mockResolvedValueOnce({ error: null }),
      enqueue: vi.fn()
        .mockRejectedValueOnce(new Error('enqueue rejected'))
        .mockResolvedValueOnce({ error: { code: '23505' } }),
      complete: vi.fn(async () => ({ error: new Error('completion failed') })),
    });

    await expect(removeOrEnqueueAssets(assets, subject)).resolves.toEqual({ pending: 3 });
    expect(subject.remove).toHaveBeenCalledTimes(3);
    expect(subject.enqueue).toHaveBeenCalledTimes(2);
    expect(subject.complete).toHaveBeenCalledTimes(1);
  });
});
