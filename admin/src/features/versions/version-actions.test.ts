import { describe, expect, it, vi } from 'vitest';

import {
  publishVersionReplacingPrevious,
  withdrawVersion,
  type ReplaceVersionDependencies,
} from './version-service';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const versionId = 'a3000000-0000-4000-8000-000000000001';

function replaceDependencies(
  overrides: Partial<ReplaceVersionDependencies> = {},
): ReplaceVersionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    getDraft: vi.fn(async () => ({
      source: 'storage' as const,
      id: versionId,
      appId,
      draftPath: 'operations/a4000000-0000-4000-8000-000000000001/source.apk',
      canonicalPath: `apps/${appId}/versions/${versionId}.apk`,
      size: 1024,
    })),
    inspectCanonical: vi.fn(async () => ({
      size: 1024,
      mimeType: 'application/vnd.android.package-archive',
    })),
    copyToCanonical: vi.fn(async () => undefined),
    publishRpc: vi.fn(async () => ({ data: [], error: null })),
    cleanupAssets: vi.fn(async () => ({ queued: 0, alreadyQueued: 0, enqueueFailures: 0, auditFailures: 0 })),
    externalPublishingEnabled: false,
    ...overrides,
  };
}

describe('publishVersionReplacingPrevious', () => {
  it('copies and verifies the canonical Storage object before the replacement RPC', async () => {
    const events: string[] = [];
    let canonicalExists = false;
    const subject = replaceDependencies({
      inspectCanonical: vi.fn(async () => {
        events.push('inspect');
        return canonicalExists
          ? { size: 1024, mimeType: 'application/vnd.android.package-archive' }
          : null;
      }),
      copyToCanonical: vi.fn(async () => {
        events.push('copy');
        canonicalExists = true;
      }),
      publishRpc: vi.fn(async () => {
        events.push('rpc');
        return { data: [], error: null };
      }),
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: false },
    });
    expect(events).toEqual(['inspect', 'copy', 'inspect', 'rpc']);
  });

  it('rejects a canonical object with an unapproved MIME before the RPC', async () => {
    const subject = replaceDependencies({
      inspectCanonical: vi.fn(async () => ({ size: 1024, mimeType: 'text/plain' })),
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(subject.publishRpc).not.toHaveBeenCalled();
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('blocks an external candidate before the RPC when rollout is disabled', async () => {
    const subject = replaceDependencies({
      getDraft: vi.fn(async () => ({
        source: 'external' as const,
        id: versionId,
        appId,
        apkUrl: 'https://downloads.example.com/app.apk',
      })),
      publishRpc: vi.fn(),
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'FEATURE_DISABLED' },
    });
    expect(subject.inspectCanonical).not.toHaveBeenCalled();
    expect(subject.publishRpc).not.toHaveBeenCalled();
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('rejects a non-public external URL before the replacement RPC', async () => {
    const subject = replaceDependencies({
      getDraft: vi.fn(async () => ({
        source: 'external' as const,
        id: versionId,
        appId,
        apkUrl: 'https://127.0.0.1/private.apk',
      })),
      externalPublishingEnabled: true,
      publishRpc: vi.fn(),
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(subject.publishRpc).not.toHaveBeenCalled();
    expect(subject.cleanupAssets).not.toHaveBeenCalled();
  });

  it('publishes an external draft without touching Storage when rollout is enabled', async () => {
    const inspectCanonical = vi.fn();
    const copyToCanonical = vi.fn();
    const cleanupAssets = vi.fn(async () => ({ queued: 0, alreadyQueued: 0, enqueueFailures: 0, auditFailures: 0 }));
    const subject = replaceDependencies({
      getDraft: vi.fn(async () => ({
        source: 'external' as const,
        id: versionId,
        appId,
        apkUrl: 'https://downloads.example.com/app.apk',
      })),
      inspectCanonical,
      copyToCanonical,
      cleanupAssets,
      externalPublishingEnabled: true,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: false },
    });
    expect(inspectCanonical).not.toHaveBeenCalled();
    expect(copyToCanonical).not.toHaveBeenCalled();
    expect(subject.publishRpc).toHaveBeenCalledWith(actorId, versionId);
    expect(cleanupAssets).toHaveBeenCalledWith([]);
  });

  it('rejects an invalid ID before reading or copying storage', async () => {
    const subject = replaceDependencies();

    await expect(publishVersionReplacingPrevious('not-a-uuid', subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(subject.getDraft).not.toHaveBeenCalled();
    expect(subject.inspectCanonical).not.toHaveBeenCalled();
    expect(subject.copyToCanonical).not.toHaveBeenCalled();
    expect(subject.publishRpc).not.toHaveBeenCalled();
  });

  it('rejects a canonical object whose size differs before the RPC', async () => {
    const subject = replaceDependencies({
      inspectCanonical: vi.fn(async () => ({
        size: 2048,
        mimeType: 'application/vnd.android.package-archive',
      })),
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(subject.copyToCanonical).not.toHaveBeenCalled();
    expect(subject.publishRpc).not.toHaveBeenCalled();
  });

  it('leaves old catalog assets untouched when the atomic RPC fails', async () => {
    const cleanupAssets = vi.fn();
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: null, error: new Error('database details') })),
      cleanupAssets,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'TEMPORARY',
        message: 'İşlem geçici olarak tamamlanamadı. Lütfen yeniden dene.',
      },
    });
    expect(cleanupAssets).not.toHaveBeenCalled();
  });

  it('removes only returned managed Storage paths after RPC success', async () => {
    const oldVersionId = 'a3000000-0000-4000-8000-000000000002';
    const oldPath = `apps/${appId}/versions/${oldVersionId}.apk`;
    const cleanupAssets = vi.fn(async () => ({ queued: 0, alreadyQueued: 0, enqueueFailures: 0, auditFailures: 0 }));
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [oldPath], error: null })),
      cleanupAssets,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: false },
    });
    expect(cleanupAssets).toHaveBeenCalledWith([
      {
        bucket: 'apks',
        path: oldPath,
        assetId: oldVersionId,
        targetType: 'apk',
      },
      {
        bucket: 'apk-drafts',
        path: 'operations/a4000000-0000-4000-8000-000000000001/source.apk',
        assetId: 'a4000000-0000-4000-8000-000000000001',
        targetType: 'apk_draft',
      },
    ]);
  });

  it('cleans the temporary draft object after a successful storage publish', async () => {
    const cleanupAssets = vi.fn(async () => ({ queued: 0, alreadyQueued: 0, enqueueFailures: 0, auditFailures: 0 }));
    const subject = replaceDependencies({ cleanupAssets });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: true,
      data: { status: 'published' },
    });
    expect(cleanupAssets).toHaveBeenCalledWith([{
      bucket: 'apk-drafts',
      path: 'operations/a4000000-0000-4000-8000-000000000001/source.apk',
      assetId: 'a4000000-0000-4000-8000-000000000001',
      targetType: 'apk_draft',
    }]);
  });

  it('does not clean the draft when publish fails', async () => {
    const cleanupAssets = vi.fn();
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: null, error: new Error('commit failed') })),
      cleanupAssets,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'TEMPORARY' },
    });
    expect(cleanupAssets).not.toHaveBeenCalled();
  });

  it('reports cleanup pending without exposing removal errors', async () => {
    const oldVersionId = 'a3000000-0000-4000-8000-000000000003';
    const oldPath = `apps/${appId}/versions/${oldVersionId}.apk`;
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [oldPath], error: null })),
      cleanupAssets: vi.fn(async () => ({ queued: 1, alreadyQueued: 0, enqueueFailures: 0, auditFailures: 0 })),
    });

    const result = await publishVersionReplacingPrevious(versionId, subject);
    expect(result).toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: true },
    });
    expect(JSON.stringify(result)).not.toContain('storage failure');
    expect(JSON.stringify(result)).not.toContain('http');
  });

  it('does not misreport publication failure when cleanup tracking fails after the RPC commits', async () => {
    const oldVersionId = 'a3000000-0000-4000-8000-000000000004';
    const oldPath = `apps/${appId}/versions/${oldVersionId}.apk`;
    const revalidate = vi.fn();
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [oldPath], error: null })),
      cleanupAssets: vi.fn(async () => {
        throw new Error('cleanup database failure with secret details');
      }),
      revalidate,
    });

    const result = await publishVersionReplacingPrevious(versionId, subject);
    expect(result).toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: true },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(revalidate).toHaveBeenCalledWith(appId);
  });

  it('never accepts an external URL from the RPC as a cleanup target', async () => {
    const cleanupAssets = vi.fn();
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({
        data: ['https://downloads.example.com/private.apk?token=secret'],
        error: null,
      })),
      cleanupAssets,
    });

    const result = await publishVersionReplacingPrevious(versionId, subject);
    expect(result).toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: true },
    });
    expect(JSON.stringify(result)).not.toContain('downloads.example.com');
    expect(cleanupAssets).not.toHaveBeenCalled();
  });
});

describe('catalog refresh integration', () => {
  const catalogRefreshError = {
    code: 'TEMPORARY' as const,
    message: 'Katalog yenilenemedi.',
    correlationId: 'c1000000-0000-4000-8000-000000000001',
  };

  it('refreshes the catalog after a successful replacement publish', async () => {
    const order: string[] = [];
    const refreshCatalog = vi.fn(async () => {
      order.push('refresh');
      return { error: null };
    });
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => {
        order.push('rpc');
        return { data: [], error: null };
      }),
      refreshCatalog,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: false },
    });
    expect(order).toEqual(['rpc', 'refresh']);
  });

  it('keeps a successful publish when the catalog refresh fails', async () => {
    const subject = replaceDependencies({
      refreshCatalog: vi.fn(async () => ({ error: catalogRefreshError })),
    });

    const result = await publishVersionReplacingPrevious(versionId, subject);
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'published', cleanupPending: false, catalogWarning: catalogRefreshError },
    });
    expect(JSON.stringify(result)).not.toContain('storage down');
  });

  it('never refreshes the catalog when the publish RPC fails', async () => {
    const refreshCatalog = vi.fn();
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: null, error: new Error('temporary') })),
      refreshCatalog,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toMatchObject({
      ok: false,
      error: { code: 'TEMPORARY' },
    });
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it('refreshes the catalog after a replacing publish and keeps cleanup semantics', async () => {
    const refreshCatalog = vi.fn(async () => ({ error: null }));
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [], error: null })),
      refreshCatalog,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: false },
    });
    expect(refreshCatalog).toHaveBeenCalledOnce();
  });

  it('supports dependency injection for withdrawing a version', async () => {
    const order: string[] = [];
    const withdrawRpc = vi.fn(async () => {
      order.push('rpc');
      return { error: null };
    });
    const refreshCatalog = vi.fn(async () => {
      order.push('refresh');
      return { error: catalogRefreshError };
    });

    const result = await withdrawVersion(versionId, {
      authorize: vi.fn(async () => ({ userId: actorId })),
      withdrawRpc,
      refreshCatalog,
    });

    expect(withdrawRpc).toHaveBeenCalledWith(actorId, versionId);
    expect(order).toEqual(['rpc', 'refresh']);
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'withdrawn', catalogWarning: catalogRefreshError },
    });
  });

  it('fails a withdraw without refreshing when the RPC fails', async () => {
    const refreshCatalog = vi.fn();

    const result = await withdrawVersion(versionId, {
      authorize: vi.fn(async () => ({ userId: actorId })),
      withdrawRpc: vi.fn(async () => ({ error: { status: 503 } })),
      refreshCatalog,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'TEMPORARY' } });
    expect(refreshCatalog).not.toHaveBeenCalled();
  });
});

// A10.36 S7.1 — the catalog operation id crosses the real action boundary.
//
// A server-action-local variable is useless here: the HTTP retry arrives as a
// new invocation. The client mints the id, sends it with the publish request,
// and every retry of that request carries the same value. These tests pin the
// server half of that contract: the id arrives as an action argument and is
// forwarded to the catalog publication unchanged.
describe('catalog operation id transport (A10.36 S7.1)', () => {
  const catalogOperationId = 'd8000000-0000-4000-8000-000000000010';
  const nextCatalogOperationId = 'd8000000-0000-4000-8000-000000000011';

  it('forwards the same operation id on every HTTP retry of one publish', async () => {
    const refreshCatalog = vi.fn(async () => ({ error: null }));
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [], error: null })),
      refreshCatalog,
    });

    await publishVersionReplacingPrevious(versionId, subject, catalogOperationId);
    await publishVersionReplacingPrevious(versionId, subject, catalogOperationId);

    expect(refreshCatalog).toHaveBeenCalledTimes(2);
    expect(refreshCatalog).toHaveBeenNthCalledWith(1, {
      operationId: catalogOperationId,
    });
    expect(refreshCatalog).toHaveBeenNthCalledWith(2, {
      operationId: catalogOperationId,
    });
  });

  it('carries a different id for a new user publish', async () => {
    const refreshCatalog = vi.fn(async () => ({ error: null }));
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [], error: null })),
      refreshCatalog,
    });

    await publishVersionReplacingPrevious(versionId, subject, catalogOperationId);
    await publishVersionReplacingPrevious(versionId, subject, nextCatalogOperationId);

    expect(refreshCatalog).toHaveBeenNthCalledWith(1, {
      operationId: catalogOperationId,
    });
    expect(refreshCatalog).toHaveBeenNthCalledWith(2, {
      operationId: nextCatalogOperationId,
    });
  });

  it('forwards the operation id through withdraw too', async () => {
    const refreshCatalog = vi.fn(async () => ({ error: null }));

    const result = await withdrawVersion(
      versionId,
      {
        authorize: vi.fn(async () => ({ userId: actorId })),
        withdrawRpc: vi.fn(async () => ({ error: null })),
        refreshCatalog,
      },
      catalogOperationId,
    );

    expect(result).toMatchObject({ ok: true });
    expect(refreshCatalog).toHaveBeenCalledWith({ operationId: catalogOperationId });
  });
});
