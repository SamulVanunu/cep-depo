import { describe, expect, it, vi } from 'vitest';

import {
  publishVersion,
  publishVersionReplacingPrevious,
  type PublishDependencies,
  type ReplaceVersionDependencies,
} from './version-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const versionId = 'a3000000-0000-4000-8000-000000000001';

function dependencies(overrides: Partial<PublishDependencies> = {}): PublishDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    getDraft: vi.fn(async () => ({
      source: 'storage' as const,
      id: versionId,
      appId,
      draftPath: 'operations/op/source.apk',
      canonicalPath: `apps/${appId}/versions/${versionId}.apk`,
      size: 1024,
    })),
    inspectCanonical: vi.fn(async () => ({ size: 1024 })),
    copyToCanonical: vi.fn(async () => undefined),
    publishRpc: vi.fn(async () => ({ error: null })),
    externalPublishingEnabled: false,
    ...overrides,
  };
}

describe('publishVersion', () => {
it('reuses an existing canonical object after RPC failure and publishes only after verification', async () => {
  let canonicalExists = false;
  let rpcCalls = 0;
  const revalidate = vi.fn();
  const subject = dependencies({
    inspectCanonical: vi.fn(async () => canonicalExists ? { size: 1024 } : null),
    copyToCanonical: vi.fn(async () => { canonicalExists = true; }),
    publishRpc: vi.fn(async () => {
      rpcCalls += 1;
      return rpcCalls === 1 ? { error: new Error('temporary') } : { error: null };
    }),
    revalidate,
  });

  await expect(publishVersion(versionId, subject)).resolves.toMatchObject({
    ok: false,
    error: { code: 'TEMPORARY' },
  });
  expect(subject.copyToCanonical).toHaveBeenCalledOnce();
  expect(revalidate).not.toHaveBeenCalled();

  await expect(publishVersion(versionId, subject)).resolves.toEqual({
    ok: true,
    data: { status: 'published' },
  });
  expect(subject.copyToCanonical).toHaveBeenCalledOnce();
  expect(subject.publishRpc).toHaveBeenCalledTimes(2);
  expect(subject.publishRpc).toHaveBeenLastCalledWith(actorId, versionId);
  expect(revalidate).toHaveBeenCalledOnce();
  expect(revalidate).toHaveBeenCalledWith(appId);
});
});

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
    cleanupAssets: vi.fn(async () => ({ pending: 0 })),
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
    const cleanupAssets = vi.fn(async () => ({ pending: 0 }));
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [oldPath], error: null })),
      cleanupAssets,
    });

    await expect(publishVersionReplacingPrevious(versionId, subject)).resolves.toEqual({
      ok: true,
      data: { status: 'published', cleanupPending: false },
    });
    expect(cleanupAssets).toHaveBeenCalledWith([{
      bucket: 'apks',
      path: oldPath,
      operationId: oldVersionId,
      targetType: 'apk',
    }]);
  });

  it('reports cleanup pending without exposing removal errors', async () => {
    const oldVersionId = 'a3000000-0000-4000-8000-000000000003';
    const oldPath = `apps/${appId}/versions/${oldVersionId}.apk`;
    const subject = replaceDependencies({
      publishRpc: vi.fn(async () => ({ data: [oldPath], error: null })),
      cleanupAssets: vi.fn(async () => ({ pending: 1 })),
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

describe('publishVersion', () => {
it('always uses atomic app activation without a caller-controlled switch', async () => {
  const publishRpc = vi.fn(async () => ({ error: null }));
  const subject = dependencies({ publishRpc });

  await expect(publishVersion(versionId, subject)).resolves.toMatchObject({ ok: true });
  expect(publishRpc).toHaveBeenCalledWith(actorId, versionId);
});

it('publishes an external draft without touching Storage when rollout is enabled', async () => {
  const inspectCanonical = vi.fn();
  const copyToCanonical = vi.fn();
  const publishRpc = vi.fn(async () => ({ error: null }));
  const subject = dependencies({
    getDraft: vi.fn(async () => ({
      source: 'external' as const,
      id: versionId,
      appId,
      apkUrl: 'https://downloads.example.com/app.apk',
    })),
    inspectCanonical,
    copyToCanonical,
    publishRpc,
    externalPublishingEnabled: true,
  });

  await expect(publishVersion(versionId, subject)).resolves.toEqual({
    ok: true,
    data: { status: 'published' },
  });
  expect(inspectCanonical).not.toHaveBeenCalled();
  expect(copyToCanonical).not.toHaveBeenCalled();
  expect(publishRpc).toHaveBeenCalledWith(actorId, versionId);
});

it('preserves an external draft when rollout is disabled', async () => {
  const inspectCanonical = vi.fn();
  const copyToCanonical = vi.fn();
  const publishRpc = vi.fn();
  const subject = dependencies({
    getDraft: vi.fn(async () => ({
      source: 'external' as const,
      id: versionId,
      appId,
      apkUrl: 'https://downloads.example.com/app.apk',
    })),
    inspectCanonical,
    copyToCanonical,
    publishRpc,
    externalPublishingEnabled: false,
  });

  await expect(publishVersion(versionId, subject)).resolves.toMatchObject({
    ok: false,
    error: {
      code: 'FEATURE_DISABLED',
      message: 'Harici APK yayınlama henüz etkin değil. Taslak korundu.',
    },
  });
  expect(inspectCanonical).not.toHaveBeenCalled();
  expect(copyToCanonical).not.toHaveBeenCalled();
  expect(publishRpc).not.toHaveBeenCalled();
});

it('rejects an invalid ID before reading or copying storage', async () => {
  const subject = dependencies();
  await expect(publishVersion('not-a-uuid', subject)).resolves.toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
  expect(subject.getDraft).not.toHaveBeenCalled();
  expect(subject.inspectCanonical).not.toHaveBeenCalled();
  expect(subject.copyToCanonical).not.toHaveBeenCalled();
  expect(subject.publishRpc).not.toHaveBeenCalled();
});

it('rejects a mismatched canonical object before publication', async () => {
  const subject = dependencies({ inspectCanonical: vi.fn(async () => ({ size: 2048 })) });
  await expect(publishVersion(versionId, subject)).resolves.toMatchObject({
    ok: false,
    error: { code: 'CONFLICT' },
  });
  expect(subject.copyToCanonical).not.toHaveBeenCalled();
  expect(subject.publishRpc).not.toHaveBeenCalled();
});
});
