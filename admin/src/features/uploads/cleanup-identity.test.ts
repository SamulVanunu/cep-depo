import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../server/observability/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import type { Database } from '../../types/database.types';
import { logger } from '../../server/observability/logger';
import { cleanupPublishingAsset } from '../apps/asset-actions';
import type { PublishingAssetCleanupDependencies } from '../apps/asset-actions';
import { enqueueCleanupAssets, type CleanupOutcome } from './asset-cleanup';
import { enqueueCleanupAndAudit } from './cleanup-enqueue';
import { managedTarget } from './cleanup-paths';

const actorId = 'c0000000-0000-4000-8000-000000000001';
const appId = 'c1000000-0000-4000-8000-000000000001';
const fileA = 'c2000000-0000-4000-8000-000000000001';
const fileB = 'c2000000-0000-4000-8000-000000000002';
const versionId = 'c3000000-0000-4000-8000-000000000001';
const draftId = 'c4000000-0000-4000-8000-000000000001';
const requestId = 'c5000000-0000-4000-8000-000000000001';
const otherRequestId = 'c5000000-0000-4000-8000-000000000002';
const jobId = 'c6000000-0000-4000-8000-000000000001';
const auditId = 'c7000000-0000-4000-8000-000000000001';

function cleanupDependencies(
  outcome: CleanupOutcome = {
    queued: 0,
    alreadyQueued: 0,
    enqueueFailures: 0,
    auditFailures: 0,
  },
): PublishingAssetCleanupDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    cleanupAssets: vi.fn(async () => outcome),
  };
}

function fakeAuditClient() {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'cleanup_enqueue_orphan') return { data: jobId, error: null };
    if (name === 'admin_ensure_cleanup_audit') {
      return { data: [{ id: auditId, created: true }], error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe('managedTarget asset identity', () => {
  const releaseId = 'rel_12345678';

  it.each([
    {
      label: 'draft apk',
      bucket: 'apk-drafts',
      path: `operations/${draftId}/source.apk`,
      targetType: 'apk_draft' as const,
      assetId: draftId,
      releaseId: null,
      catalogFile: null,
    },
    {
      label: 'published apk',
      bucket: 'apks',
      path: `apps/${appId}/versions/${versionId}.apk`,
      targetType: 'apk' as const,
      assetId: versionId,
      releaseId: null,
      catalogFile: null,
    },
    {
      label: 'icon',
      bucket: 'app-assets',
      path: `apps/${appId}/icons/${fileA}.png`,
      targetType: 'icon' as const,
      assetId: fileA,
      releaseId: null,
      catalogFile: null,
    },
    {
      label: 'screenshot',
      bucket: 'app-assets',
      path: `apps/${appId}/screenshots/${fileB}.webp`,
      targetType: 'screenshot' as const,
      assetId: fileB,
      releaseId: null,
      catalogFile: null,
    },
    {
      label: 'catalog apps document',
      bucket: 'catalog',
      path: `releases/${releaseId}/apps.json`,
      targetType: 'catalog_document' as const,
      assetId: `${releaseId}/apps`,
      releaseId,
      catalogFile: 'apps',
    },
    {
      label: 'catalog categories document',
      bucket: 'catalog',
      path: `releases/${releaseId}/categories.json`,
      targetType: 'catalog_document' as const,
      assetId: `${releaseId}/categories`,
      releaseId,
      catalogFile: 'categories',
    },
  ])(
    'derives the $label identity from the storage path',
    ({ bucket, path, targetType, assetId, releaseId: expectedRelease, catalogFile }) => {
      expect(managedTarget(bucket, path, targetType)).toEqual({
        bucket,
        path,
        targetType,
        assetId,
        releaseId: expectedRelease,
        catalogFile,
      });
    },
  );

  it.each([
    ['apk-drafts', 'operations/../source.apk', 'apk_draft'],
    ['apks', `apps/${appId}/icons/${fileA}.png`, 'apk'],
    ['app-assets', `apps/${appId}/icons/${fileA}.svg`, 'icon'],
    ['app-assets', `https://downloads.example.com/${fileA}.png`, 'icon'],
    ['catalog', 'releases/../apps.json', 'catalog_document'],
    ['catalog', `releases/${releaseId}/manifest.json`, 'catalog_document'],
    ['catalog', `releases/${releaseId}/apps.json.bak`, 'catalog_document'],
    ['catalog', 'releases/short/apps.json', 'catalog_document'],
    ['catalog', 'apps.json', 'catalog_document'],
    ['apks', `releases/${releaseId}/apps.json`, 'catalog_document'],
    ['catalog', `releases/${releaseId}/apps.json`, 'apk'],
  ])('rejects a non-canonical target %s %s %s', (bucket, path, targetType) => {
    expect(managedTarget(bucket, path, targetType)).toBeNull();
  });
});

describe('cleanup audit identity', () => {
  it('sends the derived asset id as both the audit target and its legacy operation_id field', async () => {
    const subject = fakeAuditClient();
    const path = `apps/${appId}/versions/${versionId}.apk`;

    await enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset: { bucket: 'apks', path, assetId: versionId, targetType: 'apk' },
      auditAction: 'asset.cleanup_pending',
    });

    expect(subject.rpc).toHaveBeenNthCalledWith(1, 'cleanup_enqueue_orphan', {
      p_bucket: 'apks',
      p_path: path,
      p_target_type: 'apk',
    });
    expect(subject.rpc).toHaveBeenNthCalledWith(2, 'admin_ensure_cleanup_audit', {
      p_actor_id: actorId,
      p_action: 'asset.cleanup_pending',
      p_target_type: 'asset',
      p_target_id: versionId,
      p_metadata: {
        bucket: 'apks',
        path,
        operation_id: versionId,
      },
    });
  });

  it('keeps upload cleanup target_id on the path and its asset id in operation_id', async () => {
    const subject = fakeAuditClient();
    const path = `operations/${draftId}/source.apk`;

    await enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset: { bucket: 'apk-drafts', path, assetId: draftId, targetType: 'apk_draft' },
      auditAction: 'upload.cleanup',
    });

    expect(subject.rpc).toHaveBeenNthCalledWith(2, 'admin_ensure_cleanup_audit', {
      p_actor_id: actorId,
      p_action: 'upload.cleanup',
      p_target_type: 'upload',
      p_target_id: path,
      p_metadata: {
        bucket: 'apk-drafts',
        path,
        operation_id: draftId,
      },
    });
  });

  it('rejects an asset id that does not match the storage path', async () => {
    const enqueue = vi.fn();
    const path = `apps/${appId}/icons/${fileA}.png`;

    await expect(enqueueCleanupAssets([{
      bucket: 'app-assets',
      path,
      assetId: fileB,
      targetType: 'icon',
    }], { enqueue })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('cleanupPublishingAsset request identity', () => {
  const iconPath = `apps/${appId}/icons/${fileA}.png`;
  const screenshotPath = `apps/${appId}/screenshots/${fileB}.webp`;

  it('derives the asset id from the path instead of the request id', async () => {
    const subject = cleanupDependencies();

    await expect(cleanupPublishingAsset({
      appId,
      requestId,
      path: iconPath,
      kind: 'icon',
    }, subject)).resolves.toEqual({ ok: true, data: { cleanupPending: false } });

    expect(subject.cleanupAssets).toHaveBeenCalledWith([{
      bucket: 'app-assets',
      path: iconPath,
      assetId: fileA,
      targetType: 'icon',
    }]);
    expect(subject.cleanupAssets).not.toHaveBeenCalledWith([
      expect.objectContaining({ assetId: requestId }),
    ]);
  });

  it('treats the same asset with different request ids as the same cleanup target', async () => {
    const subject = cleanupDependencies();

    await cleanupPublishingAsset({ appId, requestId, path: iconPath, kind: 'icon' }, subject);
    await cleanupPublishingAsset({
      appId,
      requestId: otherRequestId,
      path: iconPath,
      kind: 'icon',
    }, subject);

    expect(subject.cleanupAssets).toHaveBeenNthCalledWith(1, [{
      bucket: 'app-assets',
      path: iconPath,
      assetId: fileA,
      targetType: 'icon',
    }]);
    expect(subject.cleanupAssets).toHaveBeenNthCalledWith(2, [{
      bucket: 'app-assets',
      path: iconPath,
      assetId: fileA,
      targetType: 'icon',
    }]);
  });

  it('derives different asset ids for different assets under one request id', async () => {
    const subject = cleanupDependencies();

    await cleanupPublishingAsset({ appId, requestId, path: iconPath, kind: 'icon' }, subject);
    await cleanupPublishingAsset({
      appId,
      requestId,
      path: screenshotPath,
      kind: 'screenshot',
    }, subject);

    expect(subject.cleanupAssets).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ path: iconPath, assetId: fileA }),
    ]);
    expect(subject.cleanupAssets).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ path: screenshotPath, assetId: fileB }),
    ]);
  });

  it.each([
    `apps/${appId}/icons/../${fileA}.png`,
    `apps/${appId}/icons/${fileA}.svg`,
    `apps/a9000000-0000-4000-8000-000000000001/icons/${fileA}.png`,
    `operations/${draftId}/source.apk`,
  ])('rejects the non-canonical asset path %s before cleanup', async path => {
    const subject = cleanupDependencies();

    await expect(cleanupPublishingAsset({
      appId,
      requestId,
      path,
      kind: 'icon',
    }, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('rejects a malformed request id without touching cleanup', async () => {
    const subject = cleanupDependencies();

    await expect(cleanupPublishingAsset({
      appId,
      requestId: 'not-a-request-id',
      path: iconPath,
      kind: 'icon',
    }, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('uses the request id only to correlate a cleanup enqueue failure', async () => {
    vi.mocked(logger.error).mockClear();
    const subject = cleanupDependencies({
      queued: 0,
      alreadyQueued: 0,
      enqueueFailures: 1,
      auditFailures: 0,
    });

    await cleanupPublishingAsset({
      appId,
      requestId,
      path: iconPath,
      kind: 'icon',
    }, subject);

    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: requestId,
      operation: 'asset.cleanup',
      targetId: fileA,
      targetType: 'icon',
    }));
  });
});
