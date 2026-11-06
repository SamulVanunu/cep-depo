import { describe, expect, it, vi } from 'vitest';

import { sha256Hex } from './payload-digest';
import {
  createCatalogRefreshAction,
  derivePublishAttemptId,
  refreshCatalogJsonFiles,
  CATALOG_PUBLISH_LEASE_SECONDS,
  type CatalogCardRow,
  type CatalogCategoryRow,
  type CatalogJsonFileName,
  type CatalogPublishCommitInput,
  type CatalogPublishIntent,
  type CatalogPublishStateRow,
  type CatalogRefreshDependencies,
} from './catalog-json';

// A10.36 S7.1 — recovery from an ambiguous commit.
//
// A commit that lands in the database while its HTTP response is lost used to
// look like a terminal conflict: the intent was already committed, `begin`
// refused the advanced generation, and the user saw a false failure. S7.1
// fixes the producer in two moves:
//
//   1. read the intent before `begin`, so an operation that already exists
//      adopts its stored release and generation instead of re-deriving them;
//   2. when that intent is committed, read the durable history result through
//      `get_catalog_publish_result` and report success without touching
//      Storage (manifest completion is S8 work).
//
// The tests below pin those two moves plus the status branches they must not
// disturb: in_progress publishes exactly as before, sealed retries reuse the
// stored bytes, failed intents stay conflicts, and the first-request race
// adopts the winner's intent.

const generatedAt = '2026-11-01T09:00:00.000Z';
const committedAt = '2026-11-01T09:00:01.000Z';
const operationId = 'd8000000-0000-4000-8000-000000000001';
const mintedReleaseId = 'd9000000-0000-4000-8000-000000000001';
const storedReleaseId = 'd9000000-0000-4000-8000-000000000002';
const newerReleaseId = 'd9000000-0000-4000-8000-000000000003';
const actorId = 'c7000000-0000-4000-8000-000000000001';
const leaseToken = 'c9000000-0000-4000-8000-000000000001';
const leaseExpiresAt = '2026-11-01T09:05:00.000Z';
const attemptId = derivePublishAttemptId(operationId);
const otherAttemptId = 'd7000000-0000-4000-8000-000000000002';

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

const inProgressIntent: CatalogPublishIntent = Object.freeze({
  operationId,
  releaseId: storedReleaseId,
  status: 'in_progress',
  expectedGeneration: 0,
  payloadDigest: null,
  attemptId: null,
  sealedAt: null,
  idempotent: false,
});

type LocalResult = Readonly<{
  operationId: string;
  releaseId: string;
  generation: number;
  committedAt: string;
  generatedAt: string;
  appCount: number;
  categoryCount: number;
  actorId: string;
  isCurrent: boolean;
  currentGeneration: number;
}>;

type LocalResultInput = Readonly<{
  operationId: string;
  attemptId: string;
  actorId: string;
  releaseId: string | null;
}>;

type HarnessOptions = Readonly<{
  /** Sequential intent reads; the last entry repeats. */
  intents?: ReadonlyArray<CatalogPublishIntent | null>;
  state?: CatalogPublishStateRow;
  result?: LocalResult | null;
  resultError?: unknown;
  beginError?: unknown;
  requestedReleaseId?: string | null;
  sealedPayload?: Readonly<{ payload: string; payloadDigest: string }> | null;
  /** S8 fence doubles. */
  claimError?: unknown;
  claimGeneration?: number;
  claimGeneratedAt?: string;
  claimAppCount?: number;
  claimCategoryCount?: number;
  claimIdempotent?: boolean;
  assertError?: unknown;
  assertResult?: boolean;
  releaseError?: unknown;
  downloadError?: unknown;
  existingManifest?: string | null;
}>;

function harness(options: HarnessOptions = {}) {
  const log: string[] = [];
  const uploads: Array<
    Readonly<{ file: CatalogJsonFileName; body: string; releaseId: string }>
  > = [];
  const mark = (step: string) => log.push(step);

  const intents = options.intents ?? [null];
  let intentIndex = 0;

  const createOperationId = vi.fn(() => {
    mark('operation_id');
    return operationId;
  });
  const createReleaseId = vi.fn(() => {
    mark('release_id');
    return mintedReleaseId;
  });
  const getIntent = vi.fn(async () => {
    mark('get_intent');
    const index = Math.min(intentIndex, intents.length - 1);
    intentIndex += 1;
    return { data: intents[index] ?? null, error: null };
  });
  const loadPublishState = vi.fn(async () => {
    mark('load_state');
    return { data: options.state ?? idleState, error: null };
  });
  const beginIntent = vi.fn(async input => {
    mark('begin');
    if (options.beginError !== undefined) {
      return { data: null, error: options.beginError };
    }
    return {
      data: {
        ...inProgressIntent,
        releaseId: input.releaseId,
        expectedGeneration: input.expectedGeneration,
      },
      error: null,
    };
  });
  const acquireLease = vi.fn(async () => {
    mark('acquire');
    return {
      data: {
        leaseToken,
        leaseExpiresAt,
        stateGeneration: (options.state ?? idleState).generation,
      },
      error: null,
    };
  });
  const loadCards = vi.fn(async () => {
    mark('load_cards');
    return { data: [card], error: null };
  });
  const loadCategories = vi.fn(async () => {
    mark('load_categories');
    return { data: [category], error: null };
  });
  const createGeneratedAt = vi.fn(() => {
    mark('generated_at');
    return generatedAt;
  });
  const sealIntent = vi.fn(async input => {
    mark('seal');
    return {
      data: {
        operationId,
        status: 'sealed',
        payloadDigest: input.payloadDigest,
        attemptId: input.attemptId,
        sealedAt: generatedAt,
        idempotent: false,
      },
      error: null,
    };
  });
  const loadSealedPayload = vi.fn(async () => {
    mark('load_sealed_payload');
    return { data: options.sealedPayload ?? null, error: null };
  });
  const assertLease = vi.fn(async () => {
    mark('assert');
    return { data: true, error: null };
  });
  const renewLease = vi.fn(async () => {
    mark('renew');
    return { error: null };
  });
  const releaseLease = vi.fn(async () => {
    mark('release');
    return { error: null };
  });
  const commit = vi.fn(async (input: CatalogPublishCommitInput) => {
    mark('commit');
    return {
      data: {
        releaseId: input.releaseId,
        generation: input.expectedGeneration + 1,
        committedAt,
        idempotent: false,
        outcome: 'committed' as const,
        failureCode: null,
      },
      error: null,
    };
  });
  const getResult = vi.fn(async (input: LocalResultInput) => {
    void input;
    mark('get_result');
    if (options.resultError !== undefined) {
      return { data: null, error: options.resultError };
    }
    return { data: options.result ?? null, error: null };
  });
  const claimManifest = vi.fn(
    async (input: Readonly<{ releaseId: string; claimSeconds: number }>) => {
      mark('claim_manifest');
      if (options.claimError !== undefined) {
        return { data: null, error: options.claimError };
      }
      return {
        data: {
          claimToken: 'c9000000-0000-4000-8000-0000000000c1',
          claimExpiresAt: '2026-10-28T12:01:00.000Z',
          generation: options.claimGeneration ?? 1,
          releaseId: input.releaseId,
          generatedAt: options.claimGeneratedAt ?? generatedAt,
          appCount: options.claimAppCount ?? 1,
          categoryCount: options.claimCategoryCount ?? 1,
          idempotent: options.claimIdempotent ?? false,
        },
        error: null,
      };
    },
  );
  const assertManifestClaim = vi.fn(async () => {
    mark('assert_manifest');
    if (options.assertError !== undefined) {
      return { data: null, error: options.assertError };
    }
    return { data: options.assertResult ?? true, error: null };
  });
  const releaseManifestClaim = vi.fn(async () => {
    mark('release_manifest');
    return { error: options.releaseError ?? null };
  });
  const downloadManifest = vi.fn(async () => {
    mark('download_manifest');
    if (options.downloadError !== undefined) {
      return { data: null, error: options.downloadError };
    }
    return { data: options.existingManifest ?? null, error: null };
  });
  const upload = vi.fn(
    async (file: CatalogJsonFileName, body: string, releaseId: string) => {
      mark(`upload:${file}`);
      uploads.push({ file, body, releaseId });
      return { error: null };
    },
  );

  const dependencies = {
    createOperationId,
    createReleaseId,
    getIntent,
    requestedReleaseId: options.requestedReleaseId ?? null,
    loadPublishState,
    beginIntent,
    acquireLease,
    loadCards,
    loadCategories,
    createGeneratedAt,
    sealIntent,
    loadSealedPayload,
    assertLease,
    renewLease,
    releaseLease,
    commit,
    getResult,
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
      createOperationId,
      createReleaseId,
      getIntent,
      loadPublishState,
      beginIntent,
      acquireLease,
      loadCards,
      loadCategories,
      createGeneratedAt,
      sealIntent,
      loadSealedPayload,
      assertLease,
      renewLease,
      releaseLease,
      commit,
      getResult,
      claimManifest,
      assertManifestClaim,
      releaseManifestClaim,
      downloadManifest,
      upload,
    },
  };
}

function committedIntent(overrides: Partial<CatalogPublishIntent> = {}): CatalogPublishIntent {
  return {
    ...inProgressIntent,
    status: 'committed',
    payloadDigest: 'f'.repeat(64),
    attemptId,
    sealedAt: generatedAt,
    ...overrides,
  };
}

function currentResult(overrides: Partial<LocalResult> = {}): LocalResult {
  return {
    operationId,
    releaseId: storedReleaseId,
    generation: 1,
    committedAt,
    generatedAt,
    appCount: 1,
    categoryCount: 1,
    actorId,
    isCurrent: true,
    currentGeneration: 1,
    ...overrides,
  };
}

function sealedState(): CatalogPublishStateRow {
  return {
    ...idleState,
    leaseToken,
    leaseExpiresAt,
    leaseOperationId: operationId,
    leaseAttemptId: attemptId,
  };
}

describe('intent pre-read (A10.36 S7.1)', () => {
  it('reads the intent before beginning and begins at the live generation when none exists', async () => {
    const subject = harness();

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.log.slice(0, 6)).toEqual([
      'operation_id',
      'get_intent',
      'release_id',
      'load_state',
      'begin',
      'acquire',
    ]);
    expect(subject.fns.beginIntent).toHaveBeenCalledOnce();
    expect(subject.fns.beginIntent.mock.calls[0]![0]).toEqual({
      operationId,
      releaseId: mintedReleaseId,
      expectedGeneration: 0,
    });
  });

  it('adopts the stored release and generation for an existing in_progress intent without calling begin', async () => {
    const subject = harness({
      intents: [{ ...inProgressIntent, expectedGeneration: 4 }],
      state: { ...idleState, generation: 4 },
    });

    // The pre-read must make these unreachable: a retry never re-mints ids or
    // re-begins an operation that already has an intent.
    subject.fns.createReleaseId.mockImplementation(() => {
      throw new Error('a retry must not mint a release id');
    });
    subject.fns.loadPublishState.mockImplementation(async () => {
      throw new Error('an in_progress pre-read must not need the state row');
    });
    subject.fns.beginIntent.mockImplementation(async () => {
      throw new Error('a pre-read intent must not be begun again');
    });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.fns.beginIntent).not.toHaveBeenCalled();
    expect(subject.fns.createReleaseId).not.toHaveBeenCalled();
    expect(subject.fns.acquireLease).toHaveBeenCalledWith({
      operationId,
      leaseSeconds: CATALOG_PUBLISH_LEASE_SECONDS,
      attemptId,
    });
    expect(subject.uploads.map(item => item.releaseId)).toEqual([
      storedReleaseId,
      storedReleaseId,
      storedReleaseId,
    ]);
    expect(subject.fns.commit.mock.calls[0]![0]).toMatchObject({
      releaseId: storedReleaseId,
      expectedGeneration: 4,
    });
  });

  it('rejects a caller-supplied release id that differs from the stored intent', async () => {
    const subject = harness({
      intents: [{ ...inProgressIntent, expectedGeneration: 4 }],
      state: { ...idleState, generation: 4 },
      requestedReleaseId: newerReleaseId,
    });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(subject.fns.beginIntent).not.toHaveBeenCalled();
    expect(subject.fns.acquireLease).not.toHaveBeenCalled();
    expect(subject.fns.upload).not.toHaveBeenCalled();
  });
});

describe('committed recovery (A10.36 S7.1)', () => {
  it('recovers a committed operation after the state generation advanced and completes the manifest', async () => {
    const subject = harness({
      intents: [committedIntent()],
      // Real post-commit shape: intent base 0, state advanced to 1.
      state: { ...idleState, generation: 1 },
      result: currentResult(),
    });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.fns.getIntent).toHaveBeenCalledOnce();
    expect(subject.fns.beginIntent).not.toHaveBeenCalled();
    expect(subject.fns.loadPublishState).not.toHaveBeenCalled();
    expect(subject.fns.acquireLease).not.toHaveBeenCalled();
    expect(subject.fns.loadCards).not.toHaveBeenCalled();
    expect(subject.fns.loadCategories).not.toHaveBeenCalled();
    expect(subject.fns.commit).not.toHaveBeenCalled();
    expect(subject.fns.getResult).toHaveBeenCalledWith({
      operationId,
      attemptId,
      actorId,
      releaseId: null,
    });
    // S8: recovery rebuilds the manifest from the committed history and writes
    // it through the same fence as a fresh publish. No release file is
    // rewritten; only the root pointer is (re)uploaded.
    expect(subject.uploads.map(item => item.file)).toEqual(['manifest.json']);
    expect(subject.uploads[0]!.releaseId).toBe(storedReleaseId);
    expect(subject.log).toEqual(
      expect.arrayContaining([
        'get_intent',
        'get_result',
        'claim_manifest',
        'download_manifest',
        'assert_manifest',
        'upload:manifest.json',
        'release_manifest',
      ]),
    );
  });

  it('treats a superseded commit as success and never touches Storage', async () => {
    const subject = harness({
      intents: [committedIntent()],
      state: { ...idleState, generation: 2 },
      result: currentResult({
        isCurrent: false,
        currentGeneration: 2,
        releaseId: storedReleaseId,
      }),
    });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });
    expect(subject.fns.upload).not.toHaveBeenCalled();
    expect(subject.fns.getResult).toHaveBeenCalledOnce();
  });

  it('passes the caller-supplied release id to the result reader', async () => {
    const subject = harness({
      intents: [committedIntent()],
      state: { ...idleState, generation: 1 },
      result: currentResult(),
      requestedReleaseId: storedReleaseId,
    });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });
    expect(subject.fns.getResult).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId: storedReleaseId }),
    );
  });

  it('fails closed when the committed result belongs to a different attempt', async () => {
    const subject = harness({
      intents: [committedIntent({ attemptId: otherAttemptId })],
      state: { ...idleState, generation: 1 },
      resultError: { code: 'CDI03', message: 'attempt mismatch' },
    });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(subject.fns.upload).not.toHaveBeenCalled();
  });

  it('fails closed when the committed result belongs to a different actor', async () => {
    const subject = harness({
      intents: [committedIntent()],
      state: { ...idleState, generation: 1 },
      resultError: { code: 'CDP05', message: 'actor mismatch' },
      requestedReleaseId: null,
    });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(subject.fns.upload).not.toHaveBeenCalled();
    // The producer binds the read to the authenticated actor; it never guesses
    // or adopts the history actor from the error.
    expect(subject.fns.getResult.mock.calls[0]![0].actorId).toBe(actorId);
  });

  it.each([
    ['history absent', { code: 'P0001', message: 'history missing' }],
    ['history inconsistent', { code: 'P0001', message: 'kind/release mismatch' }],
  ])('fails closed when the %s', async (_label, resultError) => {
    const subject = harness({
      intents: [committedIntent()],
      state: { ...idleState, generation: 1 },
      resultError,
    });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).not.toBeNull();
    expect(result.error?.code).not.toBe('VALIDATION');
    expect(subject.fns.upload).not.toHaveBeenCalled();
  });
});

describe('other intent statuses (A10.36 S7.1)', () => {
  it('keeps the sealed retry path without reloading the catalog or re-beginning', async () => {
    const payload = JSON.stringify({
      apps: '[]',
      categories: '[]',
      manifest: JSON.stringify({
        schemaVersion: 2,
        generatedAt,
        appCount: 1,
        categoryCount: 1,
        releaseId: storedReleaseId,
        files: {
          apps: `releases/${storedReleaseId}/apps.json`,
          categories: `releases/${storedReleaseId}/categories.json`,
        },
      }),
    });
    const digest = sha256Hex(new TextEncoder().encode(payload));
    const subject = harness({
      intents: [
        {
          ...inProgressIntent,
          status: 'sealed',
          payloadDigest: digest,
          attemptId,
          sealedAt: generatedAt,
        },
      ],
      state: sealedState(),
      sealedPayload: { payload, payloadDigest: digest },
    });
    subject.fns.beginIntent.mockImplementation(async () => {
      throw new Error('a sealed pre-read must not begin again');
    });
    subject.fns.loadCards.mockImplementation(async () => {
      throw new Error('a sealed retry must not load cards');
    });
    subject.fns.loadCategories.mockImplementation(async () => {
      throw new Error('a sealed retry must not load categories');
    });
    subject.fns.createGeneratedAt.mockImplementation(() => {
      throw new Error('a sealed retry must not mint a generatedAt');
    });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.fns.loadSealedPayload).toHaveBeenCalledWith({
      operationId,
      attemptId,
    });
    expect(subject.fns.beginIntent).not.toHaveBeenCalled();
    expect(subject.uploads.map(item => item.releaseId)).toEqual([
      storedReleaseId,
      storedReleaseId,
      storedReleaseId,
    ]);
  });

  it('returns a conflict for an existing failed intent without any publish work', async () => {
    const subject = harness({
      intents: [
        {
          ...inProgressIntent,
          status: 'failed',
          failureCode: 'CDP06',
          failureReason: 'generation advanced',
          attemptId,
          payloadDigest: 'f'.repeat(64),
          sealedAt: generatedAt,
        },
      ],
    });
    subject.fns.beginIntent.mockImplementation(async () => {
      throw new Error('a failed pre-read must not begin again');
    });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(subject.fns.beginIntent).not.toHaveBeenCalled();
    expect(subject.fns.acquireLease).not.toHaveBeenCalled();
    expect(subject.fns.loadCards).not.toHaveBeenCalled();
    expect(subject.fns.upload).not.toHaveBeenCalled();
    expect(subject.fns.getResult).not.toHaveBeenCalled();
  });
});

describe('first-request race (A10.36 S7.1)', () => {
  it('adopts the winner intent when begin reports the operation already exists', async () => {
    const winner = { ...inProgressIntent, expectedGeneration: 0 };
    const subject = harness({
      intents: [null, winner],
      beginError: { code: 'CDP08', message: 'operation already used' },
    });

    await expect(refreshCatalogJsonFiles(subject.dependencies)).resolves.toEqual({
      error: null,
    });

    expect(subject.fns.getIntent).toHaveBeenCalledTimes(2);
    expect(subject.fns.beginIntent).toHaveBeenCalledOnce();
    expect(subject.fns.createReleaseId).toHaveBeenCalledOnce();
    expect(subject.fns.beginIntent.mock.calls[0]![0].releaseId).toBe(mintedReleaseId);
    // The losing release id is discarded; every upload uses the winner's.
    expect(subject.uploads.map(item => item.releaseId)).toEqual([
      storedReleaseId,
      storedReleaseId,
      storedReleaseId,
    ]);
  });

  it('stops after one bounded re-read when the race does not resolve', async () => {
    const subject = harness({
      intents: [null, null],
      beginError: { code: 'CDP08', message: 'operation already used' },
    });

    const result = await refreshCatalogJsonFiles(subject.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(subject.fns.getIntent).toHaveBeenCalledTimes(2);
    expect(subject.fns.beginIntent).toHaveBeenCalledOnce();
    expect(subject.fns.upload).not.toHaveBeenCalled();
  });
});

describe('createCatalogRefreshAction S7.1 wiring', () => {
  const FLAG = 'CATALOG_JSON_ENABLED';
  const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';

  type RpcCall = Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>;

  function actionHarness(
    spec: Readonly<{
      intents?: ReadonlyArray<CatalogPublishIntent | null>;
      state?: CatalogPublishStateRow;
      result?: LocalResult | null;
      resultError?: unknown;
      rpcHandler?: (
        name: string,
        args: Readonly<Record<string, unknown>>,
      ) => Readonly<{ data: unknown; error: unknown }> | undefined;
    }> = {},
  ) {
    const rpcCalls: RpcCall[] = [];
    const uploads: Array<Readonly<{ file: string; body: string }>> = [];
    const intents = spec.intents ?? [null];
    let intentIndex = 0;
    const state = spec.state ?? idleState;
    // The claim returns the committed history row, so echo the commit/result.
    const committedValues = { generatedAt, appCount: 1, categoryCount: 1 };

    const upload = vi.fn(async (file: string, body: string) => {
      uploads.push({ file, body });
      return { data: { path: file }, error: null };
    });

    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const override = spec.rpcHandler?.(name, args);
      if (override) return override;
      switch (name) {
        case 'get_catalog_publish_intent': {
          const index = Math.min(intentIndex, intents.length - 1);
          intentIndex += 1;
          const intent = intents[index] as
            | (CatalogPublishIntent & {
                failureCode?: string | null;
                failureReason?: string | null;
              })
            | null;
          return {
            data: intent
              ? [{
                  operation_id: intent.operationId,
                  release_id: intent.releaseId,
                  status: intent.status,
                  expected_generation: intent.expectedGeneration,
                  payload_digest: intent.payloadDigest,
                  attempt_id: intent.attemptId,
                  sealed_at: intent.sealedAt,
                  failure_code: intent.failureCode,
                  failure_reason: intent.failureReason,
                  created_at: generatedAt,
                  updated_at: generatedAt,
                }]
              : [],
            error: null,
          };
        }
        case 'get_catalog_publish_result': {
          if (spec.resultError !== undefined) {
            return { data: null, error: spec.resultError };
          }
          const result = spec.result;
          if (result) {
            committedValues.generatedAt = result.generatedAt;
            committedValues.appCount = result.appCount;
            committedValues.categoryCount = result.categoryCount;
          }
          return {
            data: result
              ? [{
                  operation_id: result.operationId,
                  release_id: result.releaseId,
                  generation: result.generation,
                  committed_at: result.committedAt,
                  generated_at: result.generatedAt,
                  app_count: result.appCount,
                  category_count: result.categoryCount,
                  actor_id: result.actorId,
                  is_current: result.isCurrent,
                  current_generation: result.currentGeneration,
                }]
              : [],
            error: null,
          };
        }
        case 'begin_catalog_publish_intent':
          return {
            data: [{
              operation_id: args.p_operation_id,
              release_id: args.p_release_id,
              status: 'in_progress',
              expected_generation: args.p_expected_generation,
              payload_digest: null,
              attempt_id: null,
              sealed_at: null,
              created_at: generatedAt,
              idempotent: false,
            }],
            error: null,
          };
        case 'seal_catalog_publish_intent':
          return {
            data: [{
              operation_id: args.p_operation_id,
              status: 'sealed',
              payload_digest: args.p_payload_digest,
              attempt_id: args.p_attempt_id,
              sealed_at: generatedAt,
              idempotent: false,
            }],
            error: null,
          };
        case 'get_catalog_publish_intent_payload':
          return { data: [], error: null };
        case 'acquire_catalog_publish_lease':
          return {
            data: [{
              lease_token: leaseToken,
              lease_expires_at: leaseExpiresAt,
              state_generation: state.generation,
              idempotent: false,
            }],
            error: null,
          };
        case 'assert_catalog_publish_lease':
          return { data: true, error: null };
        case 'renew_catalog_publish_lease':
          return { data: [{ lease_expires_at: leaseExpiresAt }], error: null };
        case 'release_catalog_publish_lease':
          return { data: true, error: null };
        case 'commit_catalog_publish':
          committedValues.generatedAt = String(args.p_generated_at);
          committedValues.appCount = Number(args.p_app_count);
          committedValues.categoryCount = Number(args.p_category_count);
          return {
            data: [{
              release_id: args.p_release_id,
              generation: 1,
              committed_at: committedAt,
              idempotent: false,
              outcome: 'committed',
              failure_code: null,
            }],
            error: null,
          };
        case 'claim_catalog_manifest':
          return {
            data: [{
              claim_token: 'c9000000-0000-4000-8000-0000000000c1',
              claim_expires_at: leaseExpiresAt,
              generation: 1,
              release_id: args.p_release_id,
              generated_at: committedValues.generatedAt,
              app_count: committedValues.appCount,
              category_count: committedValues.categoryCount,
              idempotent: false,
            }],
            error: null,
          };
        case 'assert_catalog_manifest_claim':
          return { data: true, error: null };
        case 'release_catalog_manifest_claim':
          return { data: true, error: null };
        default:
          throw new Error(`unexpected rpc: ${name}`);
      }
    });

    vi.doMock(ADMIN_CLIENT_MODULE, () => ({
      getAdminClient: vi.fn(() => ({
        from: (table: string) => {
          if (table === 'catalog_publish_state') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      generation: state.generation,
                      publish_lock_token: state.leaseToken,
                      publish_lock_expires_at: state.leaseExpiresAt,
                      publish_operation_id: state.leaseOperationId,
                      publish_attempt_id: state.leaseAttemptId,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'catalog_app_cards') {
            return { select: () => ({ order: async () => ({ data: [card], error: null }) }) };
          }
          return {
            select: () => ({
              eq: () => ({
                order: () => ({ order: async () => ({ data: [category], error: null }) }),
              }),
            }),
          };
        },
        storage: {
          from: () => ({
            upload,
            download: async () => ({ data: null, error: null }),
          }),
        },
        rpc,
      })),
    }));

    const authorize = vi.fn(async () => ({ userId: actorId }) as never);
    return {
      action: createCatalogRefreshAction(authorize),
      authorize,
      rpcCalls,
      uploads,
      rpc,
    };
  }

  async function withFlag<T>(run: () => Promise<T>): Promise<T> {
    vi.resetModules();
    process.env[FLAG] = 'true';
    try {
      return await run();
    } finally {
      delete process.env[FLAG];
      vi.doUnmock(ADMIN_CLIENT_MODULE);
      vi.restoreAllMocks();
    }
  }

  it('reads a committed result through the new RPC and completes only the manifest', async () => {
    await withFlag(async () => {
      const { action, rpcCalls, uploads } = actionHarness({
        intents: [committedIntent()],
        state: { ...idleState, generation: 1 },
        result: currentResult(),
      });

      await expect(action({ operationId })).resolves.toEqual({ error: null });

      expect(rpcCalls.map(call => call.name)).toEqual([
        'get_catalog_publish_intent',
        'get_catalog_publish_result',
        'claim_catalog_manifest',
        'assert_catalog_manifest_claim',
        'release_catalog_manifest_claim',
      ]);
      const resultCall = rpcCalls.find(
        call => call.name === 'get_catalog_publish_result',
      )!;
      expect(resultCall.args).toEqual({
        p_operation_id: operationId,
        p_attempt_id: attemptId,
        p_actor_id: actorId,
        p_release_id: null,
      });
      expect(uploads.map(item => item.file)).toEqual(['manifest.json']);
    });
  });

  it('uses the caller-supplied operation id for the pre-read and the result read', async () => {
    await withFlag(async () => {
      const { action, rpcCalls } = actionHarness({
        intents: [committedIntent()],
        state: { ...idleState, generation: 1 },
        result: currentResult({ isCurrent: false, currentGeneration: 2 }),
      });

      await expect(action({ operationId })).resolves.toEqual({ error: null });

      const preRead = rpcCalls.find(
        call => call.name === 'get_catalog_publish_intent',
      )!;
      expect(preRead.args).toEqual({ p_operation_id: operationId });
    });
  });

  it('mints a different operation id for each new publish request', async () => {
    await withFlag(async () => {
      const first = actionHarness();
      await first.action();

      const second = actionHarness();
      await second.action();

      const firstPreRead = first.rpcCalls.find(
        call => call.name === 'get_catalog_publish_intent',
      )!;
      const secondPreRead = second.rpcCalls.find(
        call => call.name === 'get_catalog_publish_intent',
      )!;
      expect(firstPreRead.args.p_operation_id).not.toBe(
        secondPreRead.args.p_operation_id,
      );
    });
  });
});
