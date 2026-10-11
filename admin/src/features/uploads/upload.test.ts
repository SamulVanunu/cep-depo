import { describe, expect, it, vi } from 'vitest';

import {
  createUploadIntent,
  finalizeUpload,
  type UploadActionDependencies,
} from './upload-actions';
import { startTusUpload, type TusUploadConstructor } from './tus-upload';
import { operationPath } from './upload-schema';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a3000000-0000-4000-8000-000000000001';

function dependencies(overrides: Partial<UploadActionDependencies> = {}): UploadActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    appExists: vi.fn(async () => true),
    createId: () => operationId,
    signUpload: vi.fn(async path => ({ data: { path, token: 'token' }, error: null })),
    inspectObject: vi.fn(async () => ({ size: 1024, mimeType: 'application/vnd.android.package-archive' })),
    readMagic: vi.fn(async () => new Uint8Array([0x50, 0x4b])),
    createDraft: vi.fn(async input => ({ data: { id: input.versionId }, error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('APK upload contracts', () => {
  it('recognizes only server-generated orphan draft paths', () => {
    expect(operationPath.test('operations/a3000000-0000-4000-8000-000000000001/source.apk')).toBe(true);
    expect(operationPath.test('../operations/a3000000-0000-4000-8000-000000000001/source.apk')).toBe(false);
    expect(operationPath.test('operations/not-a-uuid/source.apk')).toBe(false);
  });
  it('rejects files above 524288000 bytes before requesting a token', async () => {
    const signUpload = vi.fn();
    const result = await createUploadIntent(
      { appId, fileName: 'release.apk', mimeType: 'application/vnd.android.package-archive', size: 524288001 },
      dependencies({ signUpload }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(signUpload).not.toHaveBeenCalled();
  });

  it('generates draft paths server-side and ignores client bucket/path fields', async () => {
    const signUpload = vi.fn(async path => ({ data: { path, token: 'token' }, error: null }));
    const result = await createUploadIntent(
      {
        appId,
        fileName: 'release.apk',
        mimeType: 'application/octet-stream',
        size: 1024,
        bucket: 'apks',
        path: 'attacker/path.apk',
      },
      dependencies({ signUpload }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: { bucket: 'apk-drafts', path: `operations/${operationId}/source.apk` },
    });
    expect(signUpload).toHaveBeenCalledWith(`operations/${operationId}/source.apk`);
  });

  it('uses 6 MiB TUS chunks and resumes the prior fingerprint', async () => {
    const resumeFromPreviousUpload = vi.fn();
    const start = vi.fn();
    const Constructor = vi.fn(function (_file, options) {
      return {
        options,
        findPreviousUploads: async () => [{ uploadUrl: 'prior' }],
        resumeFromPreviousUpload,
        start,
      };
    }) as unknown as TusUploadConstructor;
    await startTusUpload(
      { endpoint: 'https://project.storage.supabase.co/storage/v1/upload/resumable/sign', bucket: 'apk-drafts', path: 'operations/id/source.apk', token: 'token' },
      new File(['PK'], 'release.apk', { type: 'application/vnd.android.package-archive' }),
      {},
      Constructor,
    );
    expect(Constructor).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({
      chunkSize: 6 * 1024 * 1024,
      headers: { 'x-signature': 'token' },
    }));
    expect(resumeFromPreviousUpload).toHaveBeenCalledWith({ uploadUrl: 'prior' });
    expect(start).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'non-PK magic', inspect: { size: 1024, mimeType: 'application/octet-stream' }, magic: [0, 0] },
    { name: 'mismatched size', inspect: { size: 2048, mimeType: 'application/octet-stream' }, magic: [0x50, 0x4b] },
  ])('rejects $name during finalize', async ({ inspect, magic }) => {
    const createDraft = vi.fn();
    const result = await finalizeUpload(
      {
        appId,
        operationId,
        versionName: '1.0.0',
        versionCode: 1,
        changelog: '',
        size: 1024,
        sha256: 'a'.repeat(64),
      },
      dependencies({
        inspectObject: vi.fn(async () => inspect),
        readMagic: vi.fn(async () => new Uint8Array(magic)),
        createDraft,
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(createDraft).not.toHaveBeenCalled();
  });
});
