import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './payload-digest';
import {
  buildCatalogDocuments,
  buildCatalogPublishPayload,
  derivePublishAttemptId,
  refreshCatalogJsonFiles,
  type CatalogCardRow,
  type CatalogCategoryRow,
  type CatalogJsonFileName,
  type CatalogManifestClaim,
  type CatalogManifestClaimInput,
  type CatalogManifestClaimToken,
  type CatalogPublishCommitInput,
  type CatalogPublishIntent,
  type CatalogPublishResult,
  type CatalogPublishStateRow,
  type CatalogRefreshDependencies,
} from './catalog-json';

// A10.36 S8 — the mutable root manifest fence.
//
// The commit is durable before the manifest is written. A slow publisher must
// never restore its own generation after a newer commit has moved the pointer.
// The manifest has no generation field, so the fence is database-side:
//
//   commit -> claim_catalog_manifest -> download -> (skip | assert -> upload)
//          -> release_catalog_manifest_claim
//
// What the producer must do, and what these tests pin:
//
//   * fresh publish and committed recovery take exactly the same path;
//   * an already-correct manifest is not rewritten, but the claim is released;
//   * a wrong/missing manifest is repaired only after the claim is asserted;
//   * a claim lost, expired, superseded or refused means no manifest write;
//   * CDP06 (a newer commit owns the pointer) is a successful stop, because
//     this publication is still durable and simply superseded;
//   * upload and release failures are reported without hiding a correct
//     manifest or a durable commit;
//   * recovery rebuilds the exact bytes of the first publish from committed
//     history, including PostgreSQL's `+00:00` spelling.

const generatedAt = '2026-11-01T09:00:00.000Z';
const generatedAtPg = '2026-11-01T09:00:00+00:00';
const committedAt = '2026-11-01T09:00:01.000Z';
const operationId = 'e8000000-0000-4000-8000-000000000001';
const recoveryOperationId = 'e8000000-0000-4000-8000-000000000002';
const releaseId = 'e9000000-0000-4000-8000-000000000001';
const recoveryReleaseId = 'e9000000-0000-4000-8000-000000000002';
const actorId = 'c7000000-0000-4000-8000-000000000001';
const leaseToken = 'c9000000-0000-4000-8000-000000000001';
const leaseExpiresAt = '2026-11-01T09:05:00.000Z';
const claimToken = 'f1000000-0000-4000-8000-000000000001';
const attemptId = derivePublishAttemptId(operationId);
const recoveryAttemptId = derivePublishAttemptId(recoveryOperationId);

const card: CatalogCardRow = {
  app_id: 'a2000000-0000-4000-8000-000000000001',
  slug: 'ornek-uygulama',
  title: 'Örnek Uygulama 🚀',
  short_description: 'Yeterince uzun kısa açıklama',
  icon_path: 'apps/a2000000-0000-4000-8000-000000000001/icons/icon.png',
  category_id: 'a3000000-0000-4000-8000-000000000001',
  category_name: 'Genel',
  category_slug: 'genel',
  featured: true,
  download_count: 3,
  version_id: 'a4000000-0000-4000-8000-000000000001',
  version_name: '1.0.0',
  version_code: 1,
  version_changelog: 'İlk sürüm',
  apk_path:
    'apps/a2000000-0000-4000-8000-000000000001/versions/a4000000-0000-4000-8000-000000000001.apk',
  apk_size_bytes: 1024,
  sha256: 'a'.repeat(64),
  published_at: '2026-10-27T09:00:00.000Z',
  download_source: 'storage',
  apk_url: null,
  supports_mobile: true,
  supports_tv: false,
  account_requirement: 'none',
};

const category: CatalogCategoryRow = {
  id: 'a3000000-0000-4000-8000-000000000001',
  slug: 'genel',
  name: 'Genel',
  position: 0,
};

const idleState: CatalogPublishStateRow = Object.freeze({
  generation: 0,
  leaseToken: null,
  leaseExpiresAt: null,
  leaseOperationId: null,
  leaseAttemptId: null,
});

function expectedManifest(
  release = releaseId,
  at = generatedAt,
): string {
  return buildCatalogPublishPayload(
    buildCatalogDocuments([card], [category], at),
    release,
  ).files.manifest;
}

type Options = Readonly<{
  mode?: 'fresh' | 'recovery';
  operation?: string;
  release?: string;
  claimError?: unknown;
  claimTokenOverride?: string;
  claimReleaseId?: string;
  claimGeneratedAt?: string;
  claimAppCount?: number;
  claimCategoryCount?: number;
  assertError?: unknown;
  assertResult?: boolean;
  releaseError?: unknown;
  downloadError?: unknown;
  existingManifest?: string | null;
  manifestUploadError?: unknown;
}>;

function harness(options: Options = {}) {
  const mode = options.mode ?? 'fresh';
  const operation =
    options.operation ?? (mode === 'recovery' ? recoveryOperationId : operationId);
  const attempt = derivePublishAttemptId(operation);
  const release =
    options.release ?? (mode === 'recovery' ? recoveryReleaseId : releaseId);
  const log: string[] = [];
  const uploads: Array<
    Readonly<{ file: CatalogJsonFileName; body: string; releaseId: string }>
  > = [];
  const mark = (step: string) => log.push(step);

  const inProgressIntent: CatalogPublishIntent = Object.freeze({
    operationId: operation,
    releaseId: release,
    status: 'in_progress',
    expectedGeneration: 0,
    payloadDigest: null,
    attemptId: null,
    sealedAt: null,
    idempotent: false,
  });
  const committedIntent: CatalogPublishIntent = Object.freeze({
    ...inProgressIntent,
    status: 'committed',
    payloadDigest: 'f'.repeat(64),
    attemptId: attempt,
    sealedAt: generatedAt,
  });
  const result: CatalogPublishResult = Object.freeze({
    operationId: operation,
    releaseId: release,
    generation: 1,
    committedAt,
    generatedAt,
    appCount: 1,
    categoryCount: 1,
    actorId,
    isCurrent: true,
    currentGeneration: 1,
  });

  const claimManifest = vi.fn(async (input: CatalogManifestClaimInput) => {
    mark('claim');
    if (options.claimError !== undefined) {
      return { data: null, error: options.claimError };
    }
    const claim: CatalogManifestClaim = {
      claimToken: options.claimTokenOverride ?? claimToken,
      claimExpiresAt: '2026-11-01T09:01:00.000Z',
      generation: 1,
      releaseId: options.claimReleaseId ?? input.releaseId,
      generatedAt: options.claimGeneratedAt ?? generatedAt,
      appCount: options.claimAppCount ?? 1,
      categoryCount: options.claimCategoryCount ?? 1,
      idempotent: false,
    };
    return { data: claim, error: null };
  });
  const assertManifestClaim = vi.fn(async (input: CatalogManifestClaimToken) => {
    void input;
    mark('assert');
    if (options.assertError !== undefined) {
      return { data: null, error: options.assertError };
    }
    return { data: options.assertResult ?? true, error: null };
  });
  const releaseManifestClaim = vi.fn(async (input: CatalogManifestClaimToken) => {
    void input;
    mark('release');
    return { error: options.releaseError ?? null };
  });
  const downloadManifest = vi.fn(async () => {
    mark('download');
    if (options.downloadError !== undefined) {
      return { data: null, error: options.downloadError };
    }
    return { data: options.existingManifest ?? null, error: null };
  });
  const upload = vi.fn(
    async (file: CatalogJsonFileName, body: string, uploadedRelease: string) => {
      mark(`upload:${file}`);
      if (file === 'manifest.json' && options.manifestUploadError !== undefined) {
        return { error: options.manifestUploadError };
      }
      uploads.push({ file, body, releaseId: uploadedRelease });
      return { error: null };
    },
  );

  const dependencies = {
    createOperationId: () => operation,
    requestedReleaseId: null,
    getIntent: vi.fn(async () => ({
      data: mode === 'recovery' ? committedIntent : null,
      error: null,
    })),
    createReleaseId: () => release,
    loadPublishState: vi.fn(async () => ({ data: idleState, error: null })),
    beginIntent: vi.fn(async () => ({ data: inProgressIntent, error: null })),
    acquireLease: vi.fn(async () => ({
      data: { leaseToken, leaseExpiresAt, stateGeneration: 0 },
      error: null,
    })),
    loadCards: vi.fn(async () => ({ data: [card], error: null })),
    loadCategories: vi.fn(async () => ({ data: [category], error: null })),
    createGeneratedAt: () => generatedAt,
    sealIntent: vi.fn(async (input: Readonly<{ payloadDigest: string }>) => ({
      data: {
        operationId: operation,
        status: 'sealed',
        payloadDigest: input.payloadDigest,
        attemptId: attempt,
        sealedAt: generatedAt,
        idempotent: false,
      },
      error: null,
    })),
    loadSealedPayload: vi.fn(async () => ({
      data: null,
      error: { code: 'CDP10', message: 'no sealed payload' },
    })),
    assertLease: vi.fn(async () => ({ data: true, error: null })),
    renewLease: vi.fn(async () => ({ error: null })),
    releaseLease: vi.fn(async () => ({ error: null })),
    commit: vi.fn(async (input: CatalogPublishCommitInput) => ({
      data: {
        releaseId: input.releaseId,
        generation: 1,
        committedAt,
        idempotent: false,
        outcome: 'committed' as const,
        failureCode: null,
      },
      error: null,
    })),
    getResult: vi.fn(async () => ({
      data: mode === 'recovery' ? result : null,
      error: null,
    })),
    claimManifest,
    assertManifestClaim,
    releaseManifestClaim,
    downloadManifest,
    upload,
    actorId,
  } as unknown as CatalogRefreshDependencies;

  return {
    dependencies,
    log,
    uploads,
    fns: {
      claimManifest,
      assertManifestClaim,
      releaseManifestClaim,
      downloadManifest,
      upload,
    },
  };
}

function manifestUploads(
  subject: ReturnType<typeof harness>,
): ReadonlyArray<Readonly<{ file: string; body: string; releaseId: string }>> {
  return subject.uploads.filter(item => item.file === 'manifest.json');
}

describe('manifest fence: fresh publish (A10.36 S8)', () => {
  it('claims, asserts, uploads and releases after the commit', async () => {
    const subject = harness();

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.log.slice(subject.log.indexOf('claim'))).toEqual([
      'claim',
      'download',
      'assert',
      'upload:manifest.json',
      'release',
    ]);
    expect(subject.fns.claimManifest).toHaveBeenCalledWith({
      operationId,
      attemptId,
      actorId,
      releaseId,
      claimSeconds: 60,
    });
    expect(manifestUploads(subject)).toEqual([
      { file: 'manifest.json', body: expectedManifest(), releaseId },
    ]);
  });

  it('skips the manifest upload when the stored document is already correct', async () => {
    const current = expectedManifest();
    const reordered = JSON.stringify({
      releaseId,
      files: JSON.parse(current).files,
      categoryCount: 1,
      appCount: 1,
      generatedAt,
      schemaVersion: 2,
    });
    const subject = harness({ existingManifest: reordered });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.fns.assertManifestClaim).not.toHaveBeenCalled();
    expect(manifestUploads(subject)).toEqual([]);
    // A correct manifest is skipped, not abandoned: the claim is still
    // released so the next publisher is not blocked until expiry.
    expect(subject.fns.releaseManifestClaim).toHaveBeenCalledOnce();
  });

  it('repairs a wrong manifest only after asserting the claim', async () => {
    const subject = harness({
      existingManifest: JSON.stringify({ releaseId: 'release-old', appCount: 0 }),
    });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.log.slice(subject.log.indexOf('claim'))).toEqual([
      'claim',
      'download',
      'assert',
      'upload:manifest.json',
      'release',
    ]);
    expect(manifestUploads(subject)).toHaveLength(1);
  });

  it('treats a missing root manifest as a first publish', async () => {
    const subject = harness({ existingManifest: null });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.fns.assertManifestClaim).toHaveBeenCalledOnce();
    expect(manifestUploads(subject)).toHaveLength(1);
  });
});

describe('manifest fence: lost claim and superseded generation (A10.36 S8)', () => {
  it('writes nothing when the claim RPC refuses the operation', async () => {
    const subject = harness({ claimError: { code: 'CDP03', message: 'not yours' } });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(subject.fns.downloadManifest).not.toHaveBeenCalled();
    expect(manifestUploads(subject)).toEqual([]);
  });

  it('stops successfully when the claim reports a newer generation', async () => {
    const subject = harness({ claimError: { code: 'CDP06', message: 'advanced' } });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.fns.downloadManifest).not.toHaveBeenCalled();
    expect(subject.fns.assertManifestClaim).not.toHaveBeenCalled();
    expect(manifestUploads(subject)).toEqual([]);
  });

  it('stops successfully when the assert reports a newer generation', async () => {
    const subject = harness({ assertError: { code: 'CDP06', message: 'advanced' } });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(manifestUploads(subject)).toEqual([]);
    expect(subject.fns.releaseManifestClaim).toHaveBeenCalledOnce();
  });

  it('does not upload when the claim expired before the assert', async () => {
    const subject = harness({ assertError: { code: 'CDP02', message: 'expired' } });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(manifestUploads(subject)).toEqual([]);
  });

  it('fails closed when assert returns false instead of throwing', async () => {
    const subject = harness({ assertResult: false });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(manifestUploads(subject)).toEqual([]);
  });

  it('reports a live claim conflict as temporary', async () => {
    const subject = harness({ claimError: { code: 'CDI04', message: 'busy' } });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(manifestUploads(subject)).toEqual([]);
  });

  it('refuses a claim that names a different release', async () => {
    const subject = harness({ claimReleaseId: 'release-other' });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(manifestUploads(subject)).toEqual([]);
    expect(subject.fns.assertManifestClaim).not.toHaveBeenCalled();
  });

  it('refuses an empty claim token', async () => {
    const subject = harness({ claimTokenOverride: '' });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(manifestUploads(subject)).toEqual([]);
  });
});

describe('manifest fence: storage failures (A10.36 S8)', () => {
  it('reports a download failure without uploading or stealing the manifest', async () => {
    const subject = harness({ downloadError: { message: 'storage down' } });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(subject.fns.assertManifestClaim).not.toHaveBeenCalled();
    expect(manifestUploads(subject)).toEqual([]);
    // The claim is released best-effort even though the read failed.
    expect(subject.fns.releaseManifestClaim).toHaveBeenCalledOnce();
  });

  it('releases the claim and reports a temporary error when the upload fails', async () => {
    const subject = harness({ manifestUploadError: { message: 'storage down' } });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(subject.fns.releaseManifestClaim).toHaveBeenCalledOnce();
  });

  it('reports a release failure after a successful upload as temporary', async () => {
    const subject = harness({ releaseError: { code: 'CDP03', message: 'lost' } });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    // The manifest is correct; only the claim cleanup failed. A retry finds
    // the stored manifest equal and skips the upload.
    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(manifestUploads(subject)).toHaveLength(1);
  });

  it('keeps a release failure on a skipped manifest visible as temporary', async () => {
    const subject = harness({
      existingManifest: expectedManifest(),
      releaseError: { code: 'CDP03', message: 'lost' },
    });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(manifestUploads(subject)).toEqual([]);
  });
});

describe('manifest fence: committed recovery shares the path (A10.36 S8)', () => {
  it('rebuilds the manifest from history and uploads only the manifest', async () => {
    const subject = harness({ mode: 'recovery' });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.uploads.map(item => item.file)).toEqual(['manifest.json']);
    expect(subject.fns.claimManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: recoveryOperationId,
        attemptId: recoveryAttemptId,
        releaseId: recoveryReleaseId,
      }),
    );
    expect(subject.log.slice(subject.log.indexOf('claim'))).toEqual([
      'claim',
      'download',
      'assert',
      'upload:manifest.json',
      'release',
    ]);
  });

  it('produces the same manifest bytes as the first publish, including +00:00 timestamps', async () => {
    const fresh = harness();
    await expect(refreshCatalogJsonFiles(fresh.dependencies)).resolves.toEqual({
      error: null,
    });

    const recovery = harness({
      mode: 'recovery',
      operation: operationId,
      release: releaseId,
      claimGeneratedAt: generatedAtPg,
    });
    await expect(
      refreshCatalogJsonFiles(recovery.dependencies),
    ).resolves.toEqual({ error: null });

    const freshManifest = manifestUploads(fresh)[0]!.body;
    const recoveredManifest = manifestUploads(recovery)[0]!.body;

    expect(recoveredManifest).toBe(freshManifest);
    expect(JSON.parse(recoveredManifest).generatedAt).toBe(generatedAt);
    expect(canonicalJson(JSON.parse(recoveredManifest))).toBe(
      canonicalJson(JSON.parse(freshManifest)),
    );
  });

  it('repairs a wrong manifest on recovery under the same fence', async () => {
    const recovery = harness({
      mode: 'recovery',
      existingManifest: JSON.stringify({ releaseId: 'release-old' }),
    });

    await expect(
      refreshCatalogJsonFiles(recovery.dependencies),
    ).resolves.toEqual({ error: null });

    expect(recovery.log).toEqual([
      'claim',
      'download',
      'assert',
      'upload:manifest.json',
      'release',
    ]);
    expect(manifestUploads(recovery)[0]!.releaseId).toBe(recoveryReleaseId);
  });

  it('skips recovery when the current manifest is already correct', async () => {
    const recovery = harness({
      mode: 'recovery',
      existingManifest: expectedManifest(recoveryReleaseId),
    });

    await expect(
      refreshCatalogJsonFiles(recovery.dependencies),
    ).resolves.toEqual({ error: null });

    expect(manifestUploads(recovery)).toEqual([]);
    expect(recovery.fns.assertManifestClaim).not.toHaveBeenCalled();
    expect(recovery.fns.releaseManifestClaim).toHaveBeenCalledOnce();
  });
});
