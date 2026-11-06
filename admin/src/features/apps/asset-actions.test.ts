import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  deleteScreenshotAction,
  setAppIconAction,
  type AssetMutationDependencies,
} from './asset-actions';

const actorId = 'b1000000-0000-4000-8000-000000000001';
const appId = 'b2000000-0000-4000-8000-000000000001';
const screenshotId = 'b3000000-0000-4000-8000-000000000001';
const oldFile = 'b4000000-0000-4000-8000-000000000001';
const newFile = 'b4000000-0000-4000-8000-000000000002';

const oldIconPath = `apps/${appId}/icons/${oldFile}.png`;
const newIconPath = `apps/${appId}/icons/${newFile}.png`;
const screenshotPath = `apps/${appId}/screenshots/${oldFile}.webp`;

function dependencies(
  overrides: Partial<AssetMutationDependencies> = {},
): AssetMutationDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    readAppIconPath: vi.fn(async () => oldIconPath),
    updateAppIcon: vi.fn(async () => ({ error: null })),
    readScreenshotPath: vi.fn(async () => screenshotPath),
    deleteScreenshotRow: vi.fn(async () => ({ error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    cleanupAssets: vi.fn(async () => ({ queued: 0, alreadyQueued: 0, enqueueFailures: 0, auditFailures: 0 })),
    ...overrides,
  };
}

describe('setAppIconAction', () => {
  it('enqueues the previous icon after a successful icon change', async () => {
    const subject = dependencies();

    await expect(setAppIconAction(appId, newIconPath, subject)).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(subject.updateAppIcon).toHaveBeenCalledWith(appId, newIconPath);
    expect(subject.cleanupAssets).toHaveBeenCalledWith([
      {
        bucket: 'app-assets',
        path: oldIconPath,
        assetId: oldFile,
        targetType: 'icon',
      },
    ]);
  });

  it('does not enqueue anything when the icon path did not change', async () => {
    const subject = dependencies({ readAppIconPath: vi.fn(async () => newIconPath) });

    await expect(setAppIconAction(appId, newIconPath, subject)).resolves.toMatchObject({
      ok: true,
    });
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('maps the CLN02 guard error to RETIRED_ASSET', async () => {
    const subject = dependencies({
      updateAppIcon: vi.fn(async () => ({ error: { code: 'CLN02' } })),
    });

    await expect(setAppIconAction(appId, oldIconPath, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RETIRED_ASSET' },
    });
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('does not fail the icon change when cleanup enqueue fails', async () => {
    const subject = dependencies({
      cleanupAssets: vi.fn(async () => {
        throw new Error('queue unavailable');
      }),
    });

    await expect(setAppIconAction(appId, newIconPath, subject)).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(subject.updateAppIcon).toHaveBeenCalled();
  });
});

describe('deleteScreenshotAction', () => {
  it('enqueues the removed screenshot object after the row is deleted', async () => {
    const events: string[] = [];
    const subject = dependencies({
      readScreenshotPath: vi.fn(async () => {
        events.push('read');
        return screenshotPath;
      }),
      deleteScreenshotRow: vi.fn(async () => {
        events.push('delete');
        return { error: null };
      }),
      cleanupAssets: vi.fn(async () => {
        events.push('cleanup');
        return { queued: 0, alreadyQueued: 0, enqueueFailures: 0, auditFailures: 0 };
      }),
    });

    await expect(deleteScreenshotAction(appId, screenshotId, subject)).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(events).toEqual(['read', 'delete', 'cleanup']);
    expect(subject.cleanupAssets).toHaveBeenCalledWith([
      {
        bucket: 'app-assets',
        path: screenshotPath,
        assetId: oldFile,
        targetType: 'screenshot',
      },
    ]);
  });

  it('does not enqueue when the row was already gone', async () => {
    const subject = dependencies({
      readScreenshotPath: vi.fn(async () => null),
      deleteScreenshotRow: vi.fn(async () => ({ error: { code: 'PGRST116' } })),
    });

    await expect(deleteScreenshotAction(appId, screenshotId, subject)).resolves.toMatchObject({
      ok: false,
    });
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('keeps the deletion successful when cleanup enqueue fails', async () => {
    const subject = dependencies({
      cleanupAssets: vi.fn(async () => {
        throw new Error('queue unavailable');
      }),
    });

    await expect(deleteScreenshotAction(appId, screenshotId, subject)).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(subject.deleteScreenshotRow).toHaveBeenCalledWith(appId, screenshotId);
  });
});
