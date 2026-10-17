import { describe, expect, it, vi } from 'vitest';

import {
  createExternalDraft,
  type ExternalDraftActionDependencies,
} from './external-draft-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const versionId = 'a3000000-0000-4000-8000-000000000001';

const raw = {
  source: 'external' as const,
  appId,
  packageName: 'com.example.release',
  fileName: 'release.apk',
  versionName: '1.2.0',
  versionCode: 12,
  changelog: 'External release',
  apkUrl: 'HTTPS://DOWNLOADS.EXAMPLE.COM/releases/app.apk',
  size: 51_000_000,
  sha256: 'a'.repeat(64),
};

function dependencies(
  overrides: Partial<ExternalDraftActionDependencies> = {},
): ExternalDraftActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    appExists: vi.fn(async () => true),
    createId: () => versionId,
    createDraft: vi.fn(async () => ({ data: { id: versionId }, error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('createExternalDraft', () => {
  it('accepts the current ApkStep external payload until Task 6 migrates callers', async () => {
    const result = await createExternalDraft(raw, dependencies());

    expect(result).toMatchObject({ ok: true });
  });

  it('authorizes first and inserts server-owned external metadata', async () => {
    const calls: string[] = [];
    const createDraft = vi.fn(async input => {
      calls.push('create');
      return { data: { id: input.versionId }, error: null };
    });
    const recordAudit = vi.fn(async () => ({ error: null }));
    const deps = dependencies({
      authorize: vi.fn(async () => {
        calls.push('authorize');
        return { userId: actorId };
      }),
      appExists: vi.fn(async () => {
        calls.push('exists');
        return true;
      }),
      createDraft,
      recordAudit,
    });

    const result = await createExternalDraft(raw, deps);

    expect(calls).toEqual(['authorize', 'exists', 'create']);
    expect(result).toEqual({
      ok: true,
      data: { id: versionId, status: 'draft', hostname: 'downloads.example.com' },
    });
    expect(createDraft).toHaveBeenCalledWith({
      actorId,
      appId,
      packageName: 'com.example.release',
      versionId,
      versionName: '1.2.0',
      versionCode: 12,
      changelog: 'External release',
      source: 'external',
      apkUrl: 'https://downloads.example.com/releases/app.apk',
      size: 51_000_000,
      sha256: 'a'.repeat(64),
    });
    expect(recordAudit).toHaveBeenCalledWith({
      actorId,
      action: 'version.draft',
      targetType: 'version',
      targetId: versionId,
      metadata: {
        download_source: 'external',
        hostname: 'downloads.example.com',
        version_code: 12,
      },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain('/releases/app.apk');
  });

  it('authorizes before rejecting malformed input', async () => {
    const authorize = vi.fn(async () => ({ userId: actorId }));
    const appExists = vi.fn(async () => true);
    const createDraft = vi.fn();

    const result = await createExternalDraft({ ...raw, appId: 'not-a-uuid' }, dependencies({
      authorize,
      appExists,
      createDraft,
    }));

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(authorize).toHaveBeenCalledOnce();
    expect(appExists).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['file name', { fileName: 'release.zip' }],
    ['URL', { apkUrl: 'http://downloads.example.com/app.apk' }],
    ['size', { size: 0 }],
    ['hash', { sha256: 'A'.repeat(64) }],
    ['version name', { versionName: '' }],
    ['version code', { versionCode: 0 }],
  ])('rejects an invalid %s before database insertion', async (_name, patch) => {
    const createDraft = vi.fn();
    const result = await createExternalDraft({ ...raw, ...patch }, dependencies({ createDraft }));
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('returns not found when the target application does not exist', async () => {
    const createDraft = vi.fn();
    const result = await createExternalDraft(raw, dependencies({
      appExists: vi.fn(async () => false),
      createDraft,
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('maps a duplicate version to a sanitized conflict', async () => {
    const recordAudit = vi.fn();
    const result = await createExternalDraft(raw, dependencies({
      createDraft: vi.fn(async () => ({ data: null, error: { code: '23505', detail: 'private' } })),
      recordAudit,
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
