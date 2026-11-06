// @vitest-environment node

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { verifyApkBytes } from './apk-verification';
import { createValidApk } from './fixtures/manifest-apk';
import { createStorageApkSource } from './storage-apk-source';
import { finalizeUpload, type UploadActionDependencies } from './upload-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a3000000-0000-4000-8000-000000000001';
const draftPath = `operations/${operationId}/source.apk`;
const mimeType = 'application/vnd.android.package-archive';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fakeRangeFetch(bytes: Uint8Array): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range');
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    if (!match) return new Response('range required', { status: 416 });
    const start = Number(match[1]);
    const endExclusive = Number(match[2]) + 1;
    return new Response(bytes.slice(start, endExclusive), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${endExclusive - 1}/${bytes.length}`,
      },
    });
  }) as typeof fetch;
}

function dependencies(
  overrides: Partial<UploadActionDependencies> = {},
): UploadActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    appExists: vi.fn(async () => true),
    createId: () => 'a4000000-0000-4000-8000-000000000001',
    signUpload: vi.fn(async path => ({ data: { path, token: 'token' }, error: null })),
    inspectObject: vi.fn(async () => ({ size: 0, mimeType })),
    verifyApk: vi.fn(async () => {
      throw new Error('verifyApk must be provided');
    }),
    cleanupDraft: vi.fn(async () => undefined),
    createDraft: vi.fn(async input => ({ data: { id: input.versionId }, error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

function finalizeInput(bytes: Uint8Array, declared: Readonly<{
  packageName: string;
  versionName: string;
  versionCode: number;
  sha256?: string;
}>) {
  return {
    source: 'storage' as const,
    appId,
    packageName: declared.packageName,
    versionName: declared.versionName,
    versionCode: declared.versionCode,
    changelog: '',
    operationId,
    size: bytes.length,
    sha256: declared.sha256 ?? sha256Hex(bytes),
    supportsMobile: true,
    supportsTv: false,
    accountRequirement: 'none' as const,
  };
}

async function apkBytes(opts: Parameters<typeof createValidApk>[0]): Promise<Uint8Array> {
  const blob = await createValidApk(opts);
  return new Uint8Array(await blob.arrayBuffer());
}

describe('finalizeUpload with a real APK over storage ranges', () => {
  it('verifies a real fixture end to end and persists parsed values', async () => {
    const bytes = await apkBytes({
      packageName: 'com.example.e2e',
      versionName: '3.0',
      versionCode: 12,
    });
    const deps = dependencies({
      inspectObject: vi.fn(async () => ({ size: bytes.length, mimeType })),
      verifyApk: (path, size) => verifyApkBytes(createStorageApkSource({
        supabaseUrl: 'https://project.test',
        secretKey: 'sb_secret_test',
        path,
        size,
        fetchImpl: fakeRangeFetch(bytes),
      })),
    });

    const result = await finalizeUpload(finalizeInput(bytes, {
      packageName: 'com.example.e2e',
      versionName: '3.0',
      versionCode: 12,
    }), deps);

    expect(result).toMatchObject({ ok: true });
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      packageName: 'com.example.e2e',
      versionName: '3.0',
      versionCode: 12,
      size: bytes.length,
      sha256: sha256Hex(bytes),
    }));
    expect(deps.cleanupDraft).not.toHaveBeenCalled();
  });

  it('rejects a forged versionCode declared by the client', async () => {
    const bytes = await apkBytes({
      packageName: 'com.example.e2e',
      versionName: '3.0',
      versionCode: 12,
    });
    const cleanupDraft = vi.fn(async () => undefined);
    const deps = dependencies({
      inspectObject: vi.fn(async () => ({ size: bytes.length, mimeType })),
      verifyApk: (path, size) => verifyApkBytes(createStorageApkSource({
        supabaseUrl: 'https://project.test',
        secretKey: 'sb_secret_test',
        path,
        size,
        fetchImpl: fakeRangeFetch(bytes),
      })),
      cleanupDraft,
    });

    const result = await finalizeUpload(finalizeInput(bytes, {
      packageName: 'com.example.e2e',
      versionName: '3.0',
      versionCode: 999,
    }), deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });

  it('rejects a PK-prefixed non-ZIP object', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(64 * 1024)]);
    const cleanupDraft = vi.fn(async () => undefined);
    const verifyApk = vi.fn((path: string, size: number) => verifyApkBytes(createStorageApkSource({
      supabaseUrl: 'https://project.test',
      secretKey: 'sb_secret_test',
      path,
      size,
      fetchImpl: fakeRangeFetch(bytes),
    })));
    const deps = dependencies({
      inspectObject: vi.fn(async () => ({ size: bytes.length, mimeType })),
      verifyApk,
      cleanupDraft,
    });

    const result = await finalizeUpload(finalizeInput(bytes, {
      packageName: 'com.example.fake',
      versionName: '1.0',
      versionCode: 1,
    }), deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(verifyApk).toHaveBeenCalledOnce();
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });
});
