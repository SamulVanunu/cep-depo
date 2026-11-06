import { describe, expect, it, vi } from 'vitest';

import { ActionException } from '../../server/errors/action-error';
import type { VerifiedApk } from './apk-verification';
import {
  createUploadIntent,
  finalizeUpload,
  type UploadActionDependencies,
} from './upload-actions';
import { startTusUpload, type TusUploadConstructor } from './tus-upload';
import { HOSTED_STORAGE_MAX_BYTES, operationPath } from './upload-schema';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a3000000-0000-4000-8000-000000000001';
const draftPath = `operations/${operationId}/source.apk`;

const finalizeInput = {
  source: 'storage' as const,
  appId,
  packageName: 'com.example.release',
  versionName: '1.0.0',
  versionCode: 1,
  changelog: '',
  operationId,
  size: 1024,
  sha256: 'a'.repeat(64),
  supportsMobile: false,
  supportsTv: true,
  accountRequirement: 'optional' as const,
};

const verifiedFile: VerifiedApk = Object.freeze({
  manifest: Object.freeze({
    packageName: 'com.example.release',
    versionName: '1.0.0',
    versionCode: 1,
  }),
  sha256: 'a'.repeat(64),
});

function dependencies(overrides: Partial<UploadActionDependencies> = {}): UploadActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    appExists: vi.fn(async () => true),
    createId: () => operationId,
    signUpload: vi.fn(async path => ({ data: { path, token: 'token' }, error: null })),
    inspectObject: vi.fn(async () => ({ size: 1024, mimeType: 'application/vnd.android.package-archive' })),
    verifyApk: vi.fn(async () => verifiedFile),
    cleanupDraft: vi.fn(async () => undefined),
    createDraft: vi.fn(async input => ({ data: { id: input.versionId }, error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('APK upload contracts', () => {
  it('persists release metadata in the Storage draft and audits only safe fields', async () => {
    const deps = dependencies();
    const result = await finalizeUpload(finalizeInput, deps);

    expect(result).toMatchObject({ ok: true });
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      supportsMobile: false,
      supportsTv: true,
      accountRequirement: 'optional',
    }));
    expect(deps.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        supports_mobile: false,
        supports_tv: true,
        account_requirement: 'optional',
      }),
    }));
  });

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
    const abort = vi.fn(async () => undefined);
    const Constructor = vi.fn(function (_file, options) {
      return {
        options,
        findPreviousUploads: async () => [{ uploadUrl: 'prior' }],
        resumeFromPreviousUpload,
        start,
        abort,
      };
    }) as unknown as TusUploadConstructor;
    const handle = await startTusUpload(
      {
        endpoint: 'https://project.storage.supabase.co/storage/v1/upload/resumable/sign',
        publishableKey: 'sb_publishable_example',
        bucket: 'apk-drafts',
        path: 'operations/id/source.apk',
        token: 'token',
      },
      new File(['PK'], 'release.apk', { type: 'application/vnd.android.package-archive' }),
      {},
      Constructor,
    );
    expect(Constructor).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({
      chunkSize: 6 * 1024 * 1024,
      headers: { apikey: 'sb_publishable_example', 'x-signature': 'token' },
    }));
    expect(resumeFromPreviousUpload).toHaveBeenCalledWith({ uploadUrl: 'prior' });
    expect(start).toHaveBeenCalledOnce();
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.keys(handle)).toEqual(['abort']);
    await handle.abort(true);
    expect(abort).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledWith(true);
  });

  it.each([
    { name: 'unsupported MIME type', inspect: { size: 1024, mimeType: 'text/plain' } },
    { name: 'mismatched size', inspect: { size: 2048, mimeType: 'application/octet-stream' } },
  ])('rejects $name during finalize', async ({ inspect }) => {
    const createDraft = vi.fn();
    const cleanupDraft = vi.fn(async () => undefined);
    const result = await finalizeUpload(
      finalizeInput,
      dependencies({
        inspectObject: vi.fn(async () => inspect),
        createDraft,
        cleanupDraft,
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(createDraft).not.toHaveBeenCalled();
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });

  it('rejects a missing storage object and cleans up the operation path', async () => {
    const cleanupDraft = vi.fn(async () => undefined);
    const result = await finalizeUpload(
      finalizeInput,
      dependencies({ inspectObject: vi.fn(async () => null), cleanupDraft }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });
});

describe('finalizeUpload APK verification', () => {
  it('persists the identity and digest verified from the file', async () => {
    const deps = dependencies();

    const result = await finalizeUpload(finalizeInput, deps);

    expect(result).toMatchObject({ ok: true });
    expect(deps.verifyApk).toHaveBeenCalledWith(draftPath, 1024);
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      packageName: verifiedFile.manifest.packageName,
      versionName: verifiedFile.manifest.versionName,
      versionCode: verifiedFile.manifest.versionCode,
      sha256: verifiedFile.sha256,
    }));
    expect(deps.cleanupDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['packageName', { packageName: 'com.example.fake' }],
    ['versionName', { versionName: '9.9.9' }],
    ['versionCode', { versionCode: 999 }],
    ['sha256', { sha256: 'b'.repeat(64) }],
  ] as const)('rejects a client-declared %s that differs from the file', async (_, override) => {
    const cleanupDraft = vi.fn(async () => undefined);
    const deps = dependencies({ cleanupDraft });

    const result = await finalizeUpload({ ...finalizeInput, ...override }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });

  it('rejects an object above 50 MB before verifying it', async () => {
    const verifyApk = vi.fn(async () => verifiedFile);
    const cleanupDraft = vi.fn(async () => undefined);

    const result = await finalizeUpload(
      finalizeInput,
      dependencies({
        inspectObject: vi.fn(async () => ({
          size: HOSTED_STORAGE_MAX_BYTES + 1,
          mimeType: 'application/vnd.android.package-archive',
        })),
        verifyApk,
        cleanupDraft,
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(verifyApk).not.toHaveBeenCalled();
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });

  it('cleans up when verification fails temporarily', async () => {
    const cleanupDraft = vi.fn(async () => undefined);
    const deps = dependencies({
      verifyApk: vi.fn(async () => {
        throw new ActionException('TEMPORARY');
      }),
      cleanupDraft,
    });

    const result = await finalizeUpload(finalizeInput, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'TEMPORARY' } });
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });

  it('keeps the draft object when the insert conflicts with an existing draft', async () => {
    const cleanupDraft = vi.fn(async () => undefined);
    const deps = dependencies({
      createDraft: vi.fn(async () => ({ data: null, error: { code: '23505' } })),
      cleanupDraft,
    });

    const result = await finalizeUpload(finalizeInput, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    // A replay of a finalize that already succeeded hits the unique
    // (app_id, version_code) key; the existing draft still needs this object.
    expect(cleanupDraft).not.toHaveBeenCalled();
  });

  it('still cleans up when the insert fails with a non-duplicate 409', async () => {
    const cleanupDraft = vi.fn(async () => undefined);
    const deps = dependencies({
      // A foreign-key violation can come back with a 409 status, but no
      // existing draft owns this object, so the upload must not be left behind.
      createDraft: vi.fn(async () => ({ data: null, error: { code: '23503', status: 409 } })),
      cleanupDraft,
    });

    const result = await finalizeUpload(finalizeInput, deps);

    expect(result).toMatchObject({ ok: false });
    expect(cleanupDraft).toHaveBeenCalledWith(draftPath);
  });

  it('never deletes the draft object after a successful insert', async () => {
    const deps = dependencies();

    const result = await finalizeUpload(finalizeInput, deps);

    expect(result).toMatchObject({ ok: true });
    expect(deps.cleanupDraft).not.toHaveBeenCalled();
  });

  it('keeps the object when the audit fails after the row exists', async () => {
    const cleanupDraft = vi.fn(async () => undefined);
    const deps = dependencies({
      recordAudit: vi.fn(async () => ({ error: new Error('audit unavailable') })),
      cleanupDraft,
    });

    const result = await finalizeUpload(finalizeInput, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'TEMPORARY' } });
    expect(cleanupDraft).not.toHaveBeenCalled();
  });

  it('does not delete storage when the payload fails schema validation', async () => {
    const cleanupDraft = vi.fn(async () => undefined);

    const result = await finalizeUpload(
      { ...finalizeInput, size: HOSTED_STORAGE_MAX_BYTES + 1 },
      dependencies({ cleanupDraft }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    // The operation id is only a path guess at this point; it may name another
    // operation's object, so a rejected payload must not delete anything.
    expect(cleanupDraft).not.toHaveBeenCalled();
  });

  it('does not clean up when the rejected payload has no valid operation path', async () => {
    const cleanupDraft = vi.fn(async () => undefined);

    const result = await finalizeUpload(
      { ...finalizeInput, operationId: '../other', size: HOSTED_STORAGE_MAX_BYTES + 1 },
      dependencies({ cleanupDraft }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(cleanupDraft).not.toHaveBeenCalled();
  });
});
