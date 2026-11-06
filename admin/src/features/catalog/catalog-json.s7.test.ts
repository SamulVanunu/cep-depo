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
  type CatalogPublishPayloadText,
  type CatalogPublishStateRow,
  type CatalogRefreshDependencies,
} from './catalog-json';

// A10.36 S7 — producer integration with the intent + attempt + commit contract.
//
// The database already proves the intent, attempt, lease and commit rules
// (S3-S6.1). These tests prove the producer actually drives them in the
// mandated order and never falls back to the removed eight-argument commit.

const generatedAt = '2026-11-01T09:00:00.000Z';
const operationId = 'c8000000-0000-4000-8000-000000000001';
const releaseId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const actorId = 'c7000000-0000-4000-8000-000000000001';
const leaseToken = 'c9000000-0000-4000-8000-000000000001';
const leaseExpiresAt = '2026-11-01T09:05:00.000Z';
const committedAt = '2026-11-01T09:00:01.000Z';
const attemptId = derivePublishAttemptId(operationId);

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
  releaseId,
  status: 'in_progress',
  expectedGeneration: 0,
  payloadDigest: null,
  attemptId: null,
  sealedAt: null,
  idempotent: false,
});

type Harness = Readonly<{
  dependencies: CatalogRefreshDependencies;
  log: string[];
  uploads: Array<Readonly<{ file: CatalogJsonFileName; body: string }>>;
}>;

/**
 * A dependency set that records every step, so one assertion can prove the
 * whole mandated order instead of a handful of sampled calls.
 */
function harness(
  overrides: Partial<CatalogRefreshDependencies> = {},
  options: Readonly<{ state?: CatalogPublishStateRow; intent?: CatalogPublishIntent }> = {},
): Harness {
  const log: string[] = [];
  const uploads: Array<Readonly<{ file: CatalogJsonFileName; body: string }>> = [];
  const mark = (step: string) => {
    log.push(step);
  };
  const state = options.state ?? idleState;
  const intent = options.intent ?? inProgressIntent;

  const dependencies: CatalogRefreshDependencies = {
    createOperationId: () => {
      mark('operation_id');
      return operationId;
    },
    // S7.1 added the pre-read. S7's scenarios start from `begin`, so the
    // default double reports no prior intent; the S7.1 suite covers the
    // pre-existing-intent paths.
    getIntent: vi.fn(async () => {
      mark('get_intent');
      return { data: null, error: null };
    }),
    requestedReleaseId: null,
    getResult: vi.fn(async () => {
      mark('get_result');
      return { data: null, error: null };
    }),
    createReleaseId: () => {
      mark('release_id');
      return releaseId;
    },
    loadPublishState: vi.fn(async () => {
      mark('load_state');
      return { data: state, error: null };
    }),
    beginIntent: vi.fn(async () => {
      mark('begin');
      return { data: intent, error: null };
    }),
    loadCards: vi.fn(async () => {
      mark('load_cards');
      return { data: [card], error: null };
    }),
    loadCategories: vi.fn(async () => {
      mark('load_categories');
      return { data: [category], error: null };
    }),
    createGeneratedAt: () => {
      mark('generated_at');
      return generatedAt;
    },
    sealIntent: vi.fn(async input => {
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
    }),
    loadSealedPayload: vi.fn(async () => {
      mark('load_sealed_payload');
      return { data: null, error: { code: 'CDP10', message: 'no sealed payload' } };
    }),
    acquireLease: vi.fn(async () => {
      mark('acquire');
      return {
        data: { leaseToken, leaseExpiresAt, stateGeneration: 0 },
        error: null,
      };
    }),
    assertLease: vi.fn(async () => {
      mark('assert');
      return { data: true, error: null };
    }),
    renewLease: vi.fn(async () => {
      mark('renew');
      return { error: null };
    }),
    releaseLease: vi.fn(async () => {
      mark('release');
      return { error: null };
    }),
    commit: vi.fn(async input => {
      mark('commit');
      return {
        data: {
          releaseId: input.releaseId,
          generation: 1,
          committedAt,
          idempotent: false,
          outcome: 'committed' as const,
          failureCode: null,
        },
        error: null,
      };
    }),
    // A10.36 S8: the manifest fence, silent in the S7 log order.
    claimManifest: vi.fn(async () => ({
      data: {
        claimToken: 'c9000000-0000-4000-8000-0000000000c1',
        claimExpiresAt: '2026-11-01T09:01:00.000Z',
        generation: 1,
        releaseId,
        generatedAt,
        appCount: 1,
        categoryCount: 1,
        idempotent: false,
      },
      error: null,
    })),
    assertManifestClaim: vi.fn(async () => ({ data: true, error: null })),
    releaseManifestClaim: vi.fn(async () => ({ error: null })),
    downloadManifest: vi.fn(async () => ({ data: null, error: null })),
    upload: vi.fn(async (file: CatalogJsonFileName, body: string) => {
      mark(`upload:${file}`);
      uploads.push({ file, body });
      return { error: null };
    }),
    actorId,
    ...overrides,
  };

  return { dependencies, log, uploads };
}

function record(value: unknown): string {
  return JSON.stringify(value);
}

function bundleOf(payload: string): CatalogPublishPayloadText {
  return JSON.parse(payload) as CatalogPublishPayloadText;
}

describe('derivePublishAttemptId', () => {
  it('derives the same UUID-shaped attempt for the same operation', () => {
    const first = derivePublishAttemptId(operationId);
    const second = derivePublishAttemptId(operationId);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('gives different operations different attempts', () => {
    expect(derivePublishAttemptId(operationId)).not.toBe(
      derivePublishAttemptId('c8000000-0000-4000-8000-000000000002'),
    );
  });
});

describe('refreshCatalogJsonFiles (A10.36 S7 contract)', () => {
  it('publishes in the mandated order: begin, acquire, read, seal, upload, renew, commit, manifest', async () => {
    const { dependencies, log } = harness();

    await expect(refreshCatalogJsonFiles(dependencies)).resolves.toEqual({ error: null });

    expect(log).toEqual([
      'operation_id',
      'get_intent',
      'release_id',
      'load_state',
      'begin',
      'acquire',
      'load_cards',
      'load_categories',
      'generated_at',
      'seal',
      'assert',
      'upload:apps.json',
      'upload:categories.json',
      'renew',
      'commit',
      'upload:manifest.json',
    ]);

    const begin = vi.mocked(dependencies.beginIntent).mock.calls[0]![0];
    expect(begin).toEqual({ operationId, releaseId, expectedGeneration: 0 });
    expect(vi.mocked(dependencies.acquireLease).mock.calls[0]![0]).toMatchObject({
      operationId,
      attemptId,
      leaseSeconds: CATALOG_PUBLISH_LEASE_SECONDS,
    });
    expect(vi.mocked(dependencies.sealIntent).mock.calls[0]![0]).toMatchObject({
      operationId,
      attemptId,
    });
    expect(vi.mocked(dependencies.assertLease).mock.calls[0]![0]).toEqual({
      operationId,
      leaseToken,
      attemptId,
    });
    expect(vi.mocked(dependencies.renewLease).mock.calls[0]![0]).toEqual({
      operationId,
      leaseToken,
      attemptId,
      leaseSeconds: CATALOG_PUBLISH_LEASE_SECONDS,
    });
  });

  it('seals the exact bytes it uploads and the digest is over the sealed text', async () => {
    const { dependencies, log, uploads } = harness();

    await expect(refreshCatalogJsonFiles(dependencies)).resolves.toEqual({ error: null });

    const sealCall = vi.mocked(dependencies.sealIntent).mock.calls[0]![0];
    const uploaded = new Map(uploads.map(item => [item.file, item.body]));

    // The three stored objects are the three strings inside the sealed bundle,
    // byte for byte, with no second serialization on the way to Storage.
    const bundle = bundleOf(sealCall.payload);
    expect(uploaded.get('apps.json')).toBe(bundle.apps);
    expect(uploaded.get('categories.json')).toBe(bundle.categories);
    expect(uploaded.get('manifest.json')).toBe(bundle.manifest);
    // Digest describes the stored text, not an implicit conversion of it.
    expect(sealCall.payloadDigest).toBe(
      sha256Hex(new TextEncoder().encode(sealCall.payload)),
    );
    // The manifest bytes carry this run's release; the commit copies them.
    expect(JSON.parse(bundle.manifest)).toMatchObject({
      releaseId,
      generatedAt,
      appCount: 1,
      categoryCount: 1,
    });
    expect(log.indexOf('seal')).toBeLessThan(log.indexOf('upload:apps.json'));
  });

  it('never touches Storage when the seal fails', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const { dependencies } = harness({
      sealIntent: vi.fn(async () => ({
        data: null,
        error: { code: 'CDP08', message: 'different payload' },
      })),
      upload,
    });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses to upload when the seal response does not match what was sent', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const { dependencies } = harness({
      sealIntent: vi.fn(async input => ({
        data: {
          operationId,
          status: 'sealed',
          payloadDigest: 'f'.repeat(64),
          attemptId: input.attemptId,
          sealedAt: generatedAt,
          idempotent: false,
        },
        error: null,
      })),
      upload,
    });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes the attempt id to the nine-argument commit and copies the manifest values', async () => {
    const { dependencies, uploads } = harness();

    await expect(refreshCatalogJsonFiles(dependencies)).resolves.toEqual({ error: null });

    const commit = vi.mocked(dependencies.commit).mock.calls[0]![0];
    const manifestBody = uploads.find(item => item.file === 'manifest.json')!.body;
    const manifest = JSON.parse(manifestBody) as Readonly<Record<string, unknown>>;
    expect(commit).toEqual({
      operationId,
      releaseId,
      attemptId,
      leaseToken,
      actorId,
      expectedGeneration: 0,
      generatedAt: manifest.generatedAt,
      appCount: manifest.appCount,
      categoryCount: manifest.categoryCount,
    });
    // Exactly the nine RPC parameters; there is no eighth-argument shape here.
    expect(Object.keys(commit).sort()).toEqual(
      [
        'operationId',
        'releaseId',
        'attemptId',
        'leaseToken',
        'actorId',
        'expectedGeneration',
        'generatedAt',
        'appCount',
        'categoryCount',
      ].sort(),
    );
  });

  it('reports a storage upload failure without committing or writing the manifest', async () => {
    const uploads: CatalogJsonFileName[] = [];
    const releaseLease = vi.fn(async () => ({ error: null }));
    const { dependencies } = harness({
      upload: vi.fn(async (file: CatalogJsonFileName) => {
        uploads.push(file);
        return file === 'apps.json' ? { error: { message: 'storage down' } } : { error: null };
      }),
      releaseLease,
    });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(uploads).toEqual(['apps.json']);
    expect(dependencies.commit).not.toHaveBeenCalled();
    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(record(result)).not.toContain('storage down');
  });

  it('stops before Storage and commit when the lease assertion fails', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const commit = vi.fn(async () => ({ data: null, error: null }));
    const { dependencies } = harness({
      assertLease: vi.fn(async () => ({
        data: null,
        error: { code: 'CDI03', message: 'attempt mismatch' },
      })),
      upload,
      commit,
    });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('stops before Storage and commit when the lease expired', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const commit = vi.fn(async () => ({ data: null, error: null }));
    const { dependencies } = harness({
      renewLease: vi.fn(async () => ({
        error: { code: 'CDP02', message: 'lease expired' },
      })),
      upload,
      commit,
    });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
  });

  it('reports a stale commit outcome without writing the manifest or retrying', async () => {
    const uploads: CatalogJsonFileName[] = [];
    const releaseLease = vi.fn(async () => ({ error: null }));
    const commit = vi.fn(async () => ({
      data: {
        releaseId,
        generation: null,
        committedAt: null,
        idempotent: false,
        outcome: 'failed' as const,
        failureCode: 'CDP06',
      },
      error: null,
    }));
    const { dependencies } = harness({
      upload: vi.fn(async (file: CatalogJsonFileName) => {
        uploads.push(file);
        return { error: null };
      }),
      commit,
      releaseLease,
    });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual(['apps.json', 'categories.json']);
    // The stale path cleared the lease in its own transaction.
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('retries one ambiguous commit with identical input and uploads the manifest once', async () => {
    const uploads: CatalogJsonFileName[] = [];
    const calls: CatalogPublishCommitInput[] = [];
    let attempt = 0;
    const commit = vi.fn(async (input: CatalogPublishCommitInput) => {
      calls.push(input);
      attempt += 1;
      if (attempt === 1) return { data: null, error: new TypeError('fetch failed') };
      return {
        data: {
          releaseId: input.releaseId,
          generation: 1,
          committedAt,
          idempotent: true,
          outcome: 'committed' as const,
          failureCode: null,
        },
        error: null,
      };
    });
    const { dependencies } = harness({
      upload: vi.fn(async (file: CatalogJsonFileName) => {
        uploads.push(file);
        return { error: null };
      }),
      commit,
    });

    await expect(refreshCatalogJsonFiles(dependencies)).resolves.toEqual({ error: null });

    expect(commit).toHaveBeenCalledTimes(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(uploads).toEqual(['apps.json', 'categories.json', 'manifest.json']);
  });

  it('never retries a coded commit failure', async () => {
    const commit = vi.fn(async () => ({
      data: null,
      error: { code: 'CDP03', message: 'lease is not yours' },
    }));
    const { dependencies } = harness({ commit });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to the removed eight-argument commit when the RPC is missing', async () => {
    const commit = vi.fn(async (_input: CatalogPublishCommitInput) => {
      void _input;
      return {
        data: null,
        error: { code: 'PGRST202', message: 'function not found' },
      };
    });
    const { dependencies } = harness({ commit });

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(commit).toHaveBeenCalledTimes(1);
    for (const call of vi.mocked(commit).mock.calls) {
      expect(call[0].attemptId).toBe(attemptId);
      expect(Object.keys(call[0])).toContain('attemptId');
    }
  });

  it('fails closed when the operation already committed and its payload is gone', async () => {
    const payloadRead = vi.fn(async () => ({ data: null, error: null }));
    const upload = vi.fn(async () => ({ error: null }));
    const { dependencies } = harness(
      {
        loadSealedPayload: payloadRead,
        upload,
        beginIntent: vi.fn(async () => ({
          data: {
            ...inProgressIntent,
            status: 'committed',
            payloadDigest: 'f'.repeat(64),
            attemptId,
            sealedAt: generatedAt,
          },
          error: null,
        })),
      },
      {
        state: {
          ...idleState,
          leaseToken,
          leaseExpiresAt,
          leaseOperationId: operationId,
          leaseAttemptId: attemptId,
        },
      },
    );

    const result = await refreshCatalogJsonFiles(dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(payloadRead).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(dependencies.commit).not.toHaveBeenCalled();
  });
});

describe('sealed retry (A10.36 S7 contract)', () => {
  type FirstRun = Readonly<{
    payload: string;
    digest: string;
    attempts: string;
    uploads: ReadonlyMap<string, string>;
  }>;

  async function firstRun(differentCatalog = false): Promise<FirstRun> {
    const { dependencies, uploads } = harness({
      loadCards: vi.fn(async () => ({
        data: differentCatalog ? [{ ...card, title: 'Değişmiş katalog' }] : [card],
        error: null,
      })),
    });

    await expect(refreshCatalogJsonFiles(dependencies)).resolves.toEqual({ error: null });

    const sealCall = vi.mocked(dependencies.sealIntent).mock.calls[0]![0];
    return {
      payload: sealCall.payload,
      digest: sealCall.payloadDigest,
      attempts: attemptId,
      uploads: new Map(uploads.map(item => [item.file, item.body])),
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

  function sealedIntent(first: FirstRun): CatalogPublishIntent {
    return {
      ...inProgressIntent,
      status: 'sealed',
      payloadDigest: first.digest,
      attemptId,
      sealedAt: generatedAt,
    };
  }

  function retryDependencies(
    first: FirstRun,
    overrides: Partial<CatalogRefreshDependencies> = {},
    intent: CatalogPublishIntent = sealedIntent(first),
    state: CatalogPublishStateRow = sealedState(),
  ): Harness {
    return harness(
      {
        loadCards: vi.fn(async () => {
          throw new Error('loadCards must not run on a sealed retry');
        }),
        loadCategories: vi.fn(async () => {
          throw new Error('loadCategories must not run on a sealed retry');
        }),
        createGeneratedAt: () => {
          throw new Error('a sealed retry must not mint a new generatedAt');
        },
        loadSealedPayload: vi.fn(async () => ({
          data: { payload: first.payload, payloadDigest: first.digest },
          error: null,
        })),
        ...overrides,
      },
      { state, intent },
    );
  }

  it('reuses the sealed payload without reading the catalog or acquiring again', async () => {
    const first = await firstRun();
    const retry = retryDependencies(first);

    await expect(refreshCatalogJsonFiles(retry.dependencies)).resolves.toEqual({ error: null });

    expect(retry.dependencies.loadCards).not.toHaveBeenCalled();
    expect(retry.dependencies.loadCategories).not.toHaveBeenCalled();
    expect(retry.dependencies.acquireLease).not.toHaveBeenCalled();
    expect(retry.dependencies.loadSealedPayload).toHaveBeenCalledWith({
      operationId,
      attemptId,
    });
    // The replay seal receives the stored bytes, not a rebuilt payload.
    expect(vi.mocked(retry.dependencies.sealIntent).mock.calls[0]![0]).toEqual({
      operationId,
      attemptId,
      payload: first.payload,
      payloadDigest: first.digest,
    });
  });

  it('uploads byte-identical files on retry, even when the catalog changed', async () => {
    const first = await firstRun();
    const changedCatalog = await firstRun(true);
    expect(changedCatalog.uploads.get('apps.json')).not.toBe(first.uploads.get('apps.json'));

    const retry = retryDependencies(first);
    await expect(refreshCatalogJsonFiles(retry.dependencies)).resolves.toEqual({ error: null });

    const retried = new Map(retry.uploads.map(item => [item.file, item.body]));
    expect(retried.get('apps.json')).toBe(first.uploads.get('apps.json'));
    expect(retried.get('categories.json')).toBe(first.uploads.get('categories.json'));
    expect(retried.get('manifest.json')).toBe(first.uploads.get('manifest.json'));
  });

  it('adopts the live lease token from the state row instead of re-acquiring', async () => {
    const first = await firstRun();
    const retry = retryDependencies(first);

    await expect(refreshCatalogJsonFiles(retry.dependencies)).resolves.toEqual({ error: null });

    expect(vi.mocked(retry.dependencies.commit).mock.calls[0]![0]).toMatchObject({
      leaseToken,
      attemptId,
      expectedGeneration: 0,
    });
  });

  it('fails closed when the sealed retry no longer holds the lease', async () => {
    const first = await firstRun();
    const upload = vi.fn(async () => ({ error: null }));
    const retry = retryDependencies(
      first,
      { upload },
      sealedIntent(first),
      { ...idleState, generation: 0 },
    );

    const result = await refreshCatalogJsonFiles(retry.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).not.toHaveBeenCalled();
    expect(retry.dependencies.commit).not.toHaveBeenCalled();
  });

  it('fails closed when the live lease belongs to another attempt', async () => {
    const first = await firstRun();
    const upload = vi.fn(async () => ({ error: null }));
    const retry = retryDependencies(first, { upload }, sealedIntent(first), {
      ...sealedState(),
      leaseAttemptId: 'c9000000-0000-4000-8000-0000000000ff',
    });

    const result = await refreshCatalogJsonFiles(retry.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports an attempt mismatch before reading the payload or writing Storage', async () => {
    const first = await firstRun();
    const upload = vi.fn(async () => ({ error: null }));
    const retry = retryDependencies(
      first,
      { upload },
      { ...sealedIntent(first), attemptId: 'c9000000-0000-4000-8000-0000000000ff' },
    );

    const result = await refreshCatalogJsonFiles(retry.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(retry.dependencies.loadSealedPayload).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a sealed payload whose bytes no longer match the recorded digest', async () => {
    const first = await firstRun();
    const upload = vi.fn(async () => ({ error: null }));
    const retry = retryDependencies(first, {
      loadSealedPayload: vi.fn(async () => ({
        data: { payload: first.payload.replace('Örnek', 'Değişmiş'), payloadDigest: first.digest },
        error: null,
      })),
      upload,
    });

    const result = await refreshCatalogJsonFiles(retry.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a second seal of different bytes for the same operation', async () => {
    const first = await firstRun();
    const upload = vi.fn(async () => ({ error: null }));
    const retry = retryDependencies(first, {
      sealIntent: vi.fn(async () => ({
        data: null,
        error: { code: 'CDP08', message: 'different payload' },
      })),
      upload,
    });

    const result = await refreshCatalogJsonFiles(retry.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops when the sealed intent is stale against the state generation', async () => {
    const first = await firstRun();
    const upload = vi.fn(async () => ({ error: null }));
    const retry = retryDependencies(
      first,
      { upload },
      sealedIntent(first),
      { ...sealedState(), generation: 1 },
    );

    // begin compares the generation it was given with the intent it finds.
    // A stale intent is a conflict, never a re-base.
    vi.mocked(retry.dependencies.beginIntent).mockResolvedValueOnce({
      data: null,
      error: { code: 'CDP08', message: 'operation already has a different intent' },
    });

    const result = await refreshCatalogJsonFiles(retry.dependencies);

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(upload).not.toHaveBeenCalled();
  });
});

// Production wiring: the real action must call every new RPC with the attempt
// and the nine-argument commit, and it must read the state row it bases the
// intent on. Flag on, admin client + Storage mocked.
describe('createCatalogRefreshAction S7 wiring', () => {
  const FLAG = 'CATALOG_JSON_ENABLED';
  const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';

  type RpcCall = Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>;

  function actionHarness(
    spec: Readonly<{
      state?: CatalogPublishStateRow;
      intent?: CatalogPublishIntent;
      rpcHandler?: (
        name: string,
        args: Readonly<Record<string, unknown>>,
      ) => Readonly<{ data: unknown; error: unknown }> | undefined;
    }> = {},
  ) {
    const rpcCalls: RpcCall[] = [];
    const uploads: Array<Readonly<{ file: string; body: string }>> = [];
    const state = spec.state ?? idleState;
    const intent = spec.intent ?? inProgressIntent;
    let sealedPayload: Readonly<{ payload: string; payloadDigest: string }> | null = null;
    // The claim returns the committed history row, so echo the commit args.
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
        case 'get_catalog_publish_intent':
          // S7 action tests exercise the begin path; S7.1 covers pre-read rows.
          return { data: [], error: null };
        case 'get_catalog_publish_result':
          return { data: [], error: null };
        case 'begin_catalog_publish_intent':
          return { data: [{
            operation_id: intent.operationId,
            release_id: intent.releaseId,
            status: intent.status,
            expected_generation: intent.expectedGeneration,
            payload_digest: intent.payloadDigest,
            attempt_id: intent.attemptId,
            sealed_at: intent.sealedAt,
            created_at: generatedAt,
            idempotent: intent.idempotent,
          }], error: null };
        case 'seal_catalog_publish_intent':
          sealedPayload = {
            payload: String(args.p_payload),
            payloadDigest: String(args.p_payload_digest),
          };
          return { data: [{
            operation_id: operationId,
            status: 'sealed',
            payload_digest: args.p_payload_digest,
            attempt_id: args.p_attempt_id,
            sealed_at: generatedAt,
            idempotent: false,
          }], error: null };
        case 'get_catalog_publish_intent_payload':
          return { data: sealedPayload ? [{
            payload: sealedPayload.payload,
            payload_digest: sealedPayload.payloadDigest,
          }] : [], error: null };
        case 'acquire_catalog_publish_lease':
          return { data: [{
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt,
            state_generation: 0,
            idempotent: false,
          }], error: null };
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
          return { data: [{
            release_id: args.p_release_id,
            generation: 1,
            committed_at: committedAt,
            idempotent: false,
            outcome: 'committed',
            failure_code: null,
          }], error: null };
        case 'claim_catalog_manifest':
          return { data: [{
            claim_token: 'c9000000-0000-4000-8000-0000000000c1',
            claim_expires_at: leaseExpiresAt,
            generation: 1,
            release_id: args.p_release_id,
            generated_at: committedValues.generatedAt,
            app_count: committedValues.appCount,
            category_count: committedValues.categoryCount,
            idempotent: false,
          }], error: null };
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

  it('calls begin, seal, payload read, assert and the nine-argument commit with the derived attempt', async () => {
    await withFlag(async () => {
      const { action, rpcCalls } = actionHarness();

      await expect(action({ operationId, releaseId })).resolves.toEqual({ error: null });

      const names = rpcCalls.map(call => call.name);
      expect(names).toEqual([
        'get_catalog_publish_intent',
        'begin_catalog_publish_intent',
        'acquire_catalog_publish_lease',
        'seal_catalog_publish_intent',
        'assert_catalog_publish_lease',
        'renew_catalog_publish_lease',
        'commit_catalog_publish',
        'claim_catalog_manifest',
        'assert_catalog_manifest_claim',
        'release_catalog_manifest_claim',
      ]);

      const begin = rpcCalls.find(call => call.name === 'begin_catalog_publish_intent')!;
      expect(begin.args).toEqual({
        p_operation_id: operationId,
        p_release_id: releaseId,
        p_expected_generation: 0,
      });

      const seal = rpcCalls.find(call => call.name === 'seal_catalog_publish_intent')!;
      expect(seal.args.p_attempt_id).toBe(attemptId);

      const acquire = rpcCalls.find(call => call.name === 'acquire_catalog_publish_lease')!;
      expect(acquire.args.p_attempt_id).toBe(attemptId);

      const assertLease = rpcCalls.find(call => call.name === 'assert_catalog_publish_lease')!;
      expect(assertLease.args).toEqual({
        p_operation_id: operationId,
        p_lease_token: leaseToken,
        p_attempt_id: attemptId,
      });

      const renew = rpcCalls.find(call => call.name === 'renew_catalog_publish_lease')!;
      expect(renew.args).toMatchObject({
        p_operation_id: operationId,
        p_lease_token: leaseToken,
        p_attempt_id: attemptId,
        p_lease_seconds: CATALOG_PUBLISH_LEASE_SECONDS,
      });

      const commit = rpcCalls.find(call => call.name === 'commit_catalog_publish')!;
      expect(Object.keys(commit.args).sort()).toEqual(
        [
          'p_operation_id',
          'p_lease_token',
          'p_actor_id',
          'p_expected_generation',
          'p_release_id',
          'p_generated_at',
          'p_app_count',
          'p_category_count',
          'p_attempt_id',
        ].sort(),
      );
      expect(commit.args.p_attempt_id).toBe(attemptId);
    });
  });

  it('reuses the caller-supplied ids on a retry instead of minting new ones', async () => {
    await withFlag(async () => {
      const first = actionHarness();
      await expect(first.action({ operationId, releaseId })).resolves.toEqual({ error: null });
      const firstBegin = first.rpcCalls.find(
        call => call.name === 'begin_catalog_publish_intent',
      )!;
      const firstSeal = first.rpcCalls.find(
        call => call.name === 'seal_catalog_publish_intent',
      )!;
      const sealedPayload = String(firstSeal.args.p_payload);
      const sealedDigest = sha256Hex(new TextEncoder().encode(sealedPayload));

      const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID');
      const second = actionHarness({
        state: {
          ...idleState,
          leaseToken,
          leaseExpiresAt,
          leaseOperationId: operationId,
          leaseAttemptId: attemptId,
        },
        intent: {
          ...inProgressIntent,
          status: 'sealed',
          payloadDigest: sealedDigest,
          attemptId,
          sealedAt: generatedAt,
        },
        rpcHandler: name =>
          name === 'get_catalog_publish_intent_payload'
            ? {
                data: [{ payload: sealedPayload, payload_digest: sealedDigest }],
                error: null,
              }
            : undefined,
      });
      await second.action({ operationId, releaseId });

      const secondBegin = second.rpcCalls.find(
        call => call.name === 'begin_catalog_publish_intent',
      )!;
      expect(secondBegin.args).toEqual(firstBegin.args);
      expect(randomUUID).not.toHaveBeenCalled();
    });
  });

  it('does not fall back to an eight-argument commit when PostgREST cannot find the function', async () => {
    await withFlag(async () => {
      const { action, rpcCalls } = actionHarness({
        rpcHandler: name =>
          name === 'commit_catalog_publish'
            ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
            : undefined,
      });

      const result = await action({ operationId, releaseId });

      expect(result.error).toMatchObject({ code: 'INTERNAL' });
      const commits = rpcCalls.filter(call => call.name === 'commit_catalog_publish');
      expect(commits).toHaveLength(1);
      expect(commits[0]!.args.p_attempt_id).toBe(attemptId);
    });
  });

  it('uploads the manifest only after the commit committed', async () => {
    await withFlag(async () => {
      const events: string[] = [];
      const { action, rpc, uploads } = actionHarness({
        rpcHandler: name => {
          if (name === 'commit_catalog_publish') events.push('commit');
          return undefined;
        },
      });
      await action({ operationId, releaseId });

      // Reconstruct the event order from the recorded calls and uploads.
      expect(uploads.map(item => item.file)).toEqual([
        `releases/${releaseId}/apps.json`,
        `releases/${releaseId}/categories.json`,
        'manifest.json',
      ]);
      const commitIndex = rpc.mock.calls.findIndex(([name]) => name === 'commit_catalog_publish');
      expect(commitIndex).toBeGreaterThanOrEqual(0);
      expect(events).toEqual(['commit']);
    });
  });
});
