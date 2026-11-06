import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isCatalogJsonServerEnabled } from '../../lib/catalog-json-flag';
import {
  buildCatalogDocuments,
  catalogUploadPlan,
  createCatalogRefreshAction,
  derivePublishAttemptId,
  refreshCatalogJsonFiles,
  CATALOG_PUBLISH_LEASE_SECONDS,
  CATALOG_SCHEMA_VERSION,
  CATALOG_JSON_BYTE_LIMIT,
  type CatalogCardRow,
  type CatalogCategoryRow,
  type CatalogRefreshDependencies,
  type CatalogPublishCommitInput,
  type CatalogJsonFileName,
} from './catalog-json';

const generatedAt = '2026-10-28T12:00:00.000Z';
const defaultReleaseId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const operationId = 'c8000000-0000-4000-8000-000000000001';
const actorId = 'c7000000-0000-4000-8000-000000000001';
const leaseToken = 'c9000000-0000-4000-8000-000000000001';
const leaseExpiresAt = '2026-10-28T12:05:00.000Z';
const committedAt = '2026-10-28T12:00:01.000Z';

const card: CatalogCardRow = {
  app_id: 'a2000000-0000-4000-8000-000000000001',
  slug: 'ornek-uygulama',
  title: 'Örnek Uygulama',
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
  apk_path: 'apps/a2000000-0000-4000-8000-000000000001/versions/a4000000-0000-4000-8000-000000000001.apk',
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

function dependencies(
  overrides: Partial<CatalogRefreshDependencies> = {},
): CatalogRefreshDependencies {
  return {
    loadCards: vi.fn(async () => ({ data: [card], error: null })),
    loadCategories: vi.fn(async () => ({ data: [category], error: null })),
    upload: vi.fn(async () => ({ error: null })),
    createGeneratedAt: () => generatedAt,
    // A10.27/A10.34d: ids are produced inside the queued run.
    createOperationId: () => operationId,
    createReleaseId: () => defaultReleaseId,
    // A10.36 S7.1: a fresh operation has no prior intent, carries no caller
    // release id, and has no committed result to read.
    getIntent: vi.fn(async () => ({ data: null, error: null })),
    requestedReleaseId: null,
    getResult: vi.fn(async () => ({ data: null, error: null })),
    actorId,
    loadPublishState: vi.fn(async () => ({
      data: {
        generation: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        leaseOperationId: null,
        leaseAttemptId: null,
      },
      error: null,
    })),
    beginIntent: vi.fn(async () => ({
      data: {
        operationId,
        releaseId: defaultReleaseId,
        status: 'in_progress',
        expectedGeneration: 0,
        payloadDigest: null,
        attemptId: null,
        sealedAt: null,
        idempotent: false,
      },
      error: null,
    })),
    sealIntent: vi.fn(async input => ({
      data: {
        operationId,
        status: 'sealed',
        payloadDigest: input.payloadDigest,
        attemptId: input.attemptId,
        sealedAt: generatedAt,
        idempotent: false,
      },
      error: null,
    })),
    loadSealedPayload: vi.fn(async () => ({ data: null, error: null })),
    acquireLease: vi.fn(async () => ({
      data: { leaseToken, leaseExpiresAt, stateGeneration: 0 },
      error: null,
    })),
    assertLease: vi.fn(async () => ({ data: true, error: null })),
    renewLease: vi.fn(async () => ({ error: null })),
    releaseLease: vi.fn(async () => ({ error: null })),
    commit: vi.fn(async () => ({
      data: {
        releaseId: defaultReleaseId,
        generation: 1,
        committedAt,
        idempotent: false,
        outcome: 'committed' as const,
        failureCode: null,
      },
      error: null,
    })),
    // A10.36 S8: the manifest fence. The default double claims the release the
    // harness publishes, finds no stored manifest, asserts, uploads and
    // releases, so the base flows keep their three-upload shape.
    claimManifest: vi.fn(async () => ({
      data: {
        claimToken: 'c9000000-0000-4000-8000-0000000000c1',
        claimExpiresAt: '2026-10-28T12:01:00.000Z',
        generation: 1,
        releaseId: defaultReleaseId,
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
    ...overrides,
  };
}

/**
 * Default responses for the publish RPCs used by the production action.
 * Individual tests replace single calls through the harness `rpcHandler`.
 *
 * The manifest claim returns the committed history values, so the double
 * records what the commit was given and echoes it back — exactly like the
 * database row the claim reads.
 */
const committedManifestValues = {
  generatedAt,
  appCount: 1,
  categoryCount: 1,
};

function catalogRpcResponse(
  name: string,
  args: Readonly<Record<string, unknown>>,
): Readonly<{ data: unknown; error: unknown }> {
  switch (name) {
    case 'get_catalog_publish_intent':
      // A10.36 S7.1: no prior intent by default, so the flow begins fresh.
      return { data: [], error: null };
    case 'begin_catalog_publish_intent':
      return {
        data: [
          {
            operation_id: args.p_operation_id,
            release_id: args.p_release_id,
            status: 'in_progress',
            expected_generation: args.p_expected_generation,
            payload_digest: null,
            attempt_id: null,
            sealed_at: null,
            created_at: generatedAt,
            idempotent: false,
          },
        ],
        error: null,
      };
    case 'seal_catalog_publish_intent':
      return {
        data: [
          {
            operation_id: args.p_operation_id,
            status: 'sealed',
            payload_digest: args.p_payload_digest,
            attempt_id: args.p_attempt_id,
            sealed_at: generatedAt,
            idempotent: false,
          },
        ],
        error: null,
      };
    case 'get_catalog_publish_intent_payload':
      return { data: [], error: null };
    case 'acquire_catalog_publish_lease':
      return {
        data: [
          {
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt,
            state_generation: 0,
            idempotent: false,
          },
        ],
        error: null,
      };
    case 'assert_catalog_publish_lease':
      return { data: true, error: null };
    case 'renew_catalog_publish_lease':
      return { data: [{ lease_expires_at: leaseExpiresAt }], error: null };
    case 'release_catalog_publish_lease':
      return { data: true, error: null };
    case 'commit_catalog_publish':
      committedManifestValues.generatedAt = String(args.p_generated_at);
      committedManifestValues.appCount = Number(args.p_app_count);
      committedManifestValues.categoryCount = Number(args.p_category_count);
      return {
        data: [
          {
            release_id: args.p_release_id,
            generation: 1,
            committed_at: committedAt,
            idempotent: false,
            outcome: 'committed',
            failure_code: null,
          },
        ],
        error: null,
      };
    case 'get_catalog_publish_result':
      // Only a committed pre-read reaches this; the default fake has none.
      return { data: [], error: null };
    case 'claim_catalog_manifest':
      return {
        data: [
          {
            claim_token: 'c9000000-0000-4000-8000-0000000000c1',
            claim_expires_at: '2026-10-28T12:01:00.000Z',
            generation: 1,
            release_id: args.p_release_id,
            generated_at: committedManifestValues.generatedAt,
            app_count: committedManifestValues.appCount,
            category_count: committedManifestValues.categoryCount,
            idempotent: false,
          },
        ],
        error: null,
      };
    case 'assert_catalog_manifest_claim':
      return { data: true, error: null };
    case 'release_catalog_manifest_claim':
      return { data: true, error: null };
    default:
      throw new Error(`unexpected rpc: ${name}`);
  }
}

/**
 * The admin-client double for every action-level harness: the state row, the
 * two catalog reads, and a Storage/RPC stub supplied by the caller.
 */
function mockFrom(table: string): unknown {
  if (table === 'catalog_publish_state') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              generation: 0,
              publish_lock_token: null,
              publish_lock_expires_at: null,
              publish_operation_id: null,
              publish_attempt_id: null,
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
}

describe('buildCatalogDocuments', () => {
  it('produces schema-versioned documents with catalog card rows unchanged', () => {
    const documents = buildCatalogDocuments([card], [category], generatedAt);

    expect(documents.apps.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(documents.apps.generatedAt).toBe(generatedAt);
    expect(documents.apps.apps).toEqual([card]);
    expect(documents.categories.categories).toEqual([category]);
    expect(documents.manifest).toEqual({
      schemaVersion: CATALOG_SCHEMA_VERSION,
      generatedAt,
      appCount: 1,
      categoryCount: 1,
      files: { apps: 'apps.json', categories: 'categories.json' },
    });
  });

  it('reports empty catalogs without inventing rows', () => {
    const documents = buildCatalogDocuments([], [], generatedAt);

    expect(documents.apps.apps).toEqual([]);
    expect(documents.manifest.appCount).toBe(0);
    expect(documents.manifest.categoryCount).toBe(0);
  });

  it('copies input arrays so later mutations cannot rewrite a prepared run', () => {
    const cards: CatalogCardRow[] = [card];
    const documents = buildCatalogDocuments(cards, [category], generatedAt);
    cards.push({ ...card, app_id: 'a2000000-0000-4000-8000-000000000002' });

    expect(documents.apps.apps).toHaveLength(1);
  });
});

describe('catalogUploadPlan', () => {
  it('orders uploads so the manifest is written last', () => {
    const documents = buildCatalogDocuments([card], [category], generatedAt);
    const plan = catalogUploadPlan(documents);

    expect(plan.map(item => item.file)).toEqual([
      'apps.json',
      'categories.json',
      'manifest.json',
    ]);
  });

  it('serializes every file as JSON', () => {
    const documents = buildCatalogDocuments([card], [category], generatedAt);
    const [apps, categories, manifest] = catalogUploadPlan(documents);

    expect(JSON.parse(apps!.body)).toEqual(documents.apps);
    expect(JSON.parse(categories!.body)).toEqual(documents.categories);
    expect(JSON.parse(manifest!.body)).toEqual(documents.manifest);
  });
});

describe('refreshCatalogJsonFiles', () => {
  it('uploads data files before the manifest and succeeds', async () => {
    const order: CatalogJsonFileName[] = [];
    const subject = dependencies({
      upload: vi.fn(async file => {
        order.push(file);
        return { error: null };
      }),
    });

    await expect(refreshCatalogJsonFiles(subject)).resolves.toEqual({ error: null });
    expect(order).toEqual(['apps.json', 'categories.json', 'manifest.json']);
  });

  it('reports a card loading failure without uploading anything', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const subject = dependencies({
      loadCards: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
      upload,
    });

    const result = await refreshCatalogJsonFiles(subject);
    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops at a failed upload and reports a temporary warning', async () => {
    const order: CatalogJsonFileName[] = [];
    const subject = dependencies({
      upload: vi.fn(async file => {
        order.push(file);
        return file === 'apps.json' ? { error: { message: 'storage down' } } : { error: null };
      }),
    });

    const result = await refreshCatalogJsonFiles(subject);
    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(order).toEqual(['apps.json']);
    expect(JSON.stringify(result)).not.toContain('storage down');
  });

  it('serializes concurrent refreshes so upload runs never interleave', async () => {
    const events: string[] = [];
    const subject = dependencies({
      upload: vi.fn(async file => {
        events.push(`start:${file}`);
        await new Promise(resolve => setTimeout(resolve, 1));
        events.push(`end:${file}`);
        return { error: null };
      }),
    });

    await Promise.all([refreshCatalogJsonFiles(subject), refreshCatalogJsonFiles(subject)]);

    const starts = events.filter(event => event.startsWith('start:'));
    expect(starts).toEqual([
      'start:apps.json',
      'start:categories.json',
      'start:manifest.json',
      'start:apps.json',
      'start:categories.json',
      'start:manifest.json',
    ]);
  });

  it('counts UTF-8 bytes so multi-byte characters cannot hide an oversized document', () => {
    // 'ğ' is 2 bytes in UTF-8: the document stays under the limit by character
    // count but exceeds it once encoded.
    const unicodeCard: CatalogCardRow = {
      ...card,
      title: 'ç'.repeat(10),
      version_changelog: 'ğ'.repeat(CATALOG_JSON_BYTE_LIMIT / 2 + 1000),
    };
    const documents = buildCatalogDocuments([unicodeCard], [category], generatedAt);
    const appsBody = catalogUploadPlan(documents)[0]!.body;

    expect(appsBody.length).toBeLessThan(CATALOG_JSON_BYTE_LIMIT);
    expect(Buffer.byteLength(appsBody, 'utf8')).toBeGreaterThan(CATALOG_JSON_BYTE_LIMIT);
  });

  it('uploads a near-limit ASCII document that stays under the byte threshold', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const wideCard: CatalogCardRow = {
      ...card,
      version_changelog: 'a'.repeat(CATALOG_JSON_BYTE_LIMIT - 50000),
    };
    const subject = dependencies({
      loadCards: vi.fn(async () => ({ data: [wideCard], error: null })),
      upload,
    });

    await expect(refreshCatalogJsonFiles(subject)).resolves.toEqual({ error: null });
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('uploads normally for documents under the byte threshold', async () => {
    const order: CatalogJsonFileName[] = [];
    const subject = dependencies({
      upload: vi.fn(async file => {
        order.push(file);
        return { error: null };
      }),
    });

    await expect(refreshCatalogJsonFiles(subject)).resolves.toEqual({ error: null });
    expect(order).toEqual(['apps.json', 'categories.json', 'manifest.json']);
  });

  it('fails before any upload when a document exceeds the byte threshold', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const oversizedCard: CatalogCardRow = {
      ...card,
      version_changelog: 'a'.repeat(CATALOG_JSON_BYTE_LIMIT),
    };
    const subject = dependencies({
      loadCards: vi.fn(async () => ({ data: [oversizedCard], error: null })),
      upload,
    });

    const result = await refreshCatalogJsonFiles(subject);
    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('isCatalogJsonServerEnabled', () => {
  it('returns true only for the exact lowercase value true', () => {
    expect(isCatalogJsonServerEnabled({ CATALOG_JSON_ENABLED: 'true' })).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['blank', ''],
    ['false', 'false'],
    ['TRUE', 'TRUE'],
    ['True', 'True'],
    ['true with trailing space', 'true '],
    ['1', '1'],
  ])('returns false for %s', (_label, value) => {
    expect(isCatalogJsonServerEnabled({ CATALOG_JSON_ENABLED: value })).toBe(false);
  });
});

describe('createCatalogRefreshAction CATALOG_JSON_ENABLED gate', () => {
  const FLAG = 'CATALOG_JSON_ENABLED';
  const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';

  beforeEach(() => {
    delete process.env[FLAG];
  });

  afterEach(() => {
    delete process.env[FLAG];
    vi.doUnmock(ADMIN_CLIENT_MODULE);
  });

  it('skips authorization, Storage and audit without side effects when the flag is missing', async () => {
    const authorize = vi.fn();
    const recordAudit = vi.fn();
    const action = createCatalogRefreshAction(authorize as never, recordAudit as never);

    await expect(action()).resolves.toEqual({ error: null });
    expect(authorize).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it.each(['false', 'TRUE', '', '1'])(
    'skips without side effects when the flag is %j',
    async value => {
      process.env[FLAG] = value;
      const authorize = vi.fn();
      const recordAudit = vi.fn();
      const action = createCatalogRefreshAction(authorize as never, recordAudit as never);

      await expect(action()).resolves.toEqual({ error: null });
      expect(authorize).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it('does not import the admin client when the flag is off', async () => {
    const getAdminClient = vi.fn();
    vi.doMock(ADMIN_CLIENT_MODULE, () => ({ getAdminClient }));
    const action = createCatalogRefreshAction(vi.fn() as never);

    await action();

    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('runs the full refresh when the flag is exactly true', async () => {
    process.env[FLAG] = 'true';
    const upload = vi.fn(async () => ({ error: null }));
    vi.doMock(ADMIN_CLIENT_MODULE, () => ({
      getAdminClient: vi.fn(() => ({
        from: mockFrom,
        storage: {
          from: () => ({ upload, download: async () => ({ data: null, error: null }) }),
        },
        rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
          catalogRpcResponse(name, args),
        ),
      })),
    }));
    const authorize = vi.fn(async () => ({ userId: 'u1' }) as never);

    const action = createCatalogRefreshAction(authorize);
    await expect(action()).resolves.toEqual({ error: null });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(3);
  });
});

// A10.23 — Immutable producer v2 (RED contract).
// These tests define the v2 publication contract against the REAL
// `createCatalogRefreshAction` path (flag on, admin client + Storage mocked);
// only the side effects that would hit the network are faked.
describe('immutable release producer v2 (A10.23 contract)', () => {
  const FLAG = 'CATALOG_JSON_ENABLED';
  const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';
  const RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
  const RELEASE_APPS_PATTERN = /^releases\/[A-Za-z0-9_-]{8,64}\/apps\.json$/;
  const RELEASE_CATEGORIES_PATTERN = /^releases\/[A-Za-z0-9_-]{8,64}\/categories\.json$/;

  type StorageCall = Readonly<{
    bucket: string;
    file: string;
    body: string;
    options: Readonly<Record<string, unknown>> | undefined;
  }>;

  type ManifestSnapshot = Readonly<{
    releaseId?: string;
    files?: Readonly<{ apps?: string; categories?: string }>;
  }>;

  function manifestFrom(calls: readonly StorageCall[]): ManifestSnapshot {
    const call = [...calls].reverse().find(item => item.file === 'manifest.json');
    if (!call) throw new Error('manifest.json was never uploaded');
    return JSON.parse(call.body) as ManifestSnapshot;
  }

  function expectedOrder(releaseId: string | undefined): readonly string[] {
    return [
      `releases/${String(releaseId)}/apps.json`,
      `releases/${String(releaseId)}/categories.json`,
      'manifest.json',
    ];
  }

  /**
   * Runs the real refresh action against a mocked admin client: DB reads are
   * satisfied from the existing fixtures and Storage is an in-memory recorder
   * that also captures the `upsert` options production passes per upload.
   */
  function harness(
    spec: Readonly<{ failWhen?: (file: string) => boolean }> = {},
  ): Readonly<{
    action: ReturnType<typeof createCatalogRefreshAction>;
    calls: StorageCall[];
    upload: ReturnType<typeof vi.fn>;
    authorize: ReturnType<typeof vi.fn>;
  }> {
    const calls: StorageCall[] = [];
    let bucket = '';
    const upload = vi.fn(
      async (file: string, body: string, options?: Record<string, unknown>) => {
        calls.push({ bucket, file, body, options });
        if (spec.failWhen?.(file)) return { error: { message: 'storage down' } };
        return { data: { path: file }, error: null };
      },
    );
    vi.doMock(ADMIN_CLIENT_MODULE, () => ({
      getAdminClient: vi.fn(() => ({
        from: mockFrom,
        storage: {
          from: (name: string) => {
            bucket = name;
            return { upload, download: async () => ({ data: null, error: null }) };
          },
        },
        rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
          catalogRpcResponse(name, args),
        ),
      })),
    }));
    const authorize = vi.fn(async () => ({ userId: 'u1' }) as never);
    return { action: createCatalogRefreshAction(authorize), calls, upload, authorize };
  }

  beforeEach(() => {
    // Fresh module registry so each test gets its own Storage recorder.
    vi.resetModules();
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    delete process.env[FLAG];
    vi.doUnmock(ADMIN_CLIENT_MODULE);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a unique, consumer-valid releaseId for every publication', async () => {
    // Controllable dependencies: the clock is frozen, so two publications in
    // the same instant may only differ through the randomness source.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T12:00:00.000Z'));
    const randomness = vi.spyOn(globalThis.crypto, 'randomUUID');
    const { action, calls, authorize } = harness();

    await expect(action()).resolves.toEqual({ error: null });
    await expect(action()).resolves.toEqual({ error: null });

    const releaseIds = calls
      .filter(item => item.file === 'manifest.json')
      .map(item => (JSON.parse(item.body) as ManifestSnapshot).releaseId);
    expect(releaseIds).toHaveLength(2);
    for (const releaseId of releaseIds) expect(releaseId).toMatch(RELEASE_ID_PATTERN);
    expect(new Set(releaseIds).size).toBe(2);
    expect(randomness).toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(2);

    expect(calls.map(item => item.file)).toEqual([
      `releases/${releaseIds[0]}/apps.json`,
      `releases/${releaseIds[0]}/categories.json`,
      'manifest.json',
      `releases/${releaseIds[1]}/apps.json`,
      `releases/${releaseIds[1]}/categories.json`,
      'manifest.json',
    ]);
    expect(calls[0]!.options).toMatchObject({ upsert: false });
    expect(calls[1]!.options).toMatchObject({ upsert: false });
    expect(calls[2]!.options).toMatchObject({
      upsert: true,
      contentType: 'application/json',
    });
  });

  it('uploads the apps document to releases/{releaseId}/apps.json', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const releaseId = manifestFrom(calls).releaseId;
    expect(calls[0]!.bucket).toBe('catalog');
    expect(calls[0]!.file).toBe(`releases/${releaseId}/apps.json`);
    expect(calls[0]!.file).toMatch(RELEASE_APPS_PATTERN);
    expect(calls.map(item => item.file)).toEqual(expectedOrder(releaseId));
    expect(calls[0]!.options).toMatchObject({ upsert: false });
    expect(calls[2]!.options).toMatchObject({ upsert: true });
  });

  it('uploads the categories document to releases/{releaseId}/categories.json', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const releaseId = manifestFrom(calls).releaseId;
    expect(calls[1]!.file).toBe(`releases/${releaseId}/categories.json`);
    expect(calls[1]!.file).toMatch(RELEASE_CATEGORIES_PATTERN);
    expect(calls.map(item => item.file)).toEqual(expectedOrder(releaseId));
    expect(calls[1]!.options).toMatchObject({ upsert: false });
    expect(calls[2]!.options).toMatchObject({ upsert: true });
  });

  it('writes the manifest only after both release files of the same run are uploaded', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const manifest = manifestFrom(calls);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.file).toBe('manifest.json');
    // The pointer must reference exactly the two files uploaded in this run.
    expect(manifest.releaseId).toMatch(RELEASE_ID_PATTERN);
    expect(manifest.files?.apps).toBe(`releases/${manifest.releaseId}/apps.json`);
    expect(manifest.files?.categories).toBe(`releases/${manifest.releaseId}/categories.json`);
    expect(calls[0]!.file).toBe(manifest.files?.apps);
    expect(calls[1]!.file).toBe(manifest.files?.categories);
    expect(calls.map(item => item.file)).toEqual(expectedOrder(manifest.releaseId));
    expect(calls[0]!.options).toMatchObject({ upsert: false });
    expect(calls[1]!.options).toMatchObject({ upsert: false });
    expect(calls[2]!.options).toMatchObject({ upsert: true });
  });

  it('uploads both release files with upsert: false', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const releaseId = manifestFrom(calls).releaseId;
    expect(calls[0]!.options).toMatchObject({
      contentType: 'application/json',
      upsert: false,
    });
    expect(calls[1]!.options).toMatchObject({
      contentType: 'application/json',
      upsert: false,
    });
    expect(calls.map(item => item.file)).toEqual(expectedOrder(releaseId));
    expect(calls[2]!.options).toMatchObject({ upsert: true });
  });

  it('writes manifest.json with upsert: true', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const releaseId = manifestFrom(calls).releaseId;
    const manifestCall = calls.find(item => item.file === 'manifest.json');
    expect(manifestCall).toBeDefined();
    expect(manifestCall!.options).toMatchObject({
      contentType: 'application/json',
      upsert: true,
    });
    expect(calls.at(-1)).toBe(manifestCall);
    expect(calls.map(item => item.file)).toEqual(expectedOrder(releaseId));
    expect(calls[0]!.options).toMatchObject({ upsert: false });
    expect(calls[1]!.options).toMatchObject({ upsert: false });
  });

  it('uploads apps, then categories, then manifest in that exact order', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const releaseId = manifestFrom(calls).releaseId;
    expect(calls.map(item => item.file)).toEqual(expectedOrder(releaseId));
    expect(calls.map(item => item.options?.upsert)).toEqual([false, false, true]);
    expect(calls.map(item => item.bucket)).toEqual(['catalog', 'catalog', 'catalog']);
  });

  const manifestFailureCases: ReadonlyArray<
    readonly [string, (file: string) => boolean, number]
  > = [
    ['apps', file => file.endsWith('apps.json'), 1],
    ['categories', file => file.endsWith('categories.json'), 2],
  ];

  it.each(manifestFailureCases)(
    'does not update the manifest when the %s upload fails',
    async (_kind, failWhen, expectedCalls) => {
      const { action, calls } = harness({ failWhen });

      const result = await action();

      expect(result.error).toMatchObject({ code: 'TEMPORARY' });
      expect(calls).toHaveLength(expectedCalls);
      expect(calls.some(item => item.file === 'manifest.json')).toBe(false);
      expect(calls[0]!.file).toMatch(RELEASE_APPS_PATTERN);
      expect(calls[0]!.options).toMatchObject({ upsert: false });
      if (expectedCalls === 2) {
        expect(calls[1]!.file).toMatch(RELEASE_CATEGORIES_PATTERN);
        expect(calls[1]!.options).toMatchObject({ upsert: false });
      }
      expect(calls.map(item => item.options?.upsert)).not.toContain(true);
      expect(JSON.stringify(result)).not.toContain('storage down');
    },
  );

  it('reports a temporary warning without leaking details when the manifest upload fails', async () => {
    const { action, calls } = harness({ failWhen: file => file === 'manifest.json' });

    const result = await action();

    // Existing failure contract first: TEMPORARY, no storage details leaked.
    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(JSON.stringify(result)).not.toContain('storage down');
    expect(calls).toHaveLength(3);
    const releaseId = manifestFrom(calls).releaseId;
    expect(calls.map(item => item.file)).toEqual(expectedOrder(releaseId));
    expect(calls[0]!.options).toMatchObject({ upsert: false });
    expect(calls[1]!.options).toMatchObject({ upsert: false });
    expect(calls[2]!.options).toMatchObject({ upsert: true });
  });

  // A10.30 — Cache policy separation: immutable release objects vs the mutable
  // manifest pointer. Supabase Storage SDK 2.117.2 maps `cacheControl` to
  // `Cache-Control: max-age=<value>` and expects a seconds value only, so the
  // expected values here are plain digit strings.
  it('caches the immutable release files for a year', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const releaseId = manifestFrom(calls).releaseId;
    expect(calls.map(item => item.file)).toEqual(expectedOrder(releaseId));
    expect(calls[0]!.options).toMatchObject({
      cacheControl: '31536000',
      contentType: 'application/json',
      upsert: false,
    });
    expect(calls[1]!.options).toMatchObject({
      cacheControl: '31536000',
      contentType: 'application/json',
      upsert: false,
    });
  });

  it('caches the mutable manifest briefly', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const manifestCall = calls.find(item => item.file === 'manifest.json');
    expect(manifestCall).toBeDefined();
    expect(manifestCall!.options).toMatchObject({
      cacheControl: '60',
      contentType: 'application/json',
      upsert: true,
    });
    // Upload order and upsert contract stay untouched by the cache policy.
    expect(calls.map(item => item.options?.upsert)).toEqual([false, false, true]);
  });

  it('keeps release and manifest cache policies explicitly separate', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const releaseCacheControl = String(calls[0]!.options?.cacheControl);
    const manifestCacheControl = String(calls[2]!.options?.cacheControl);
    const releaseSeconds = Number(releaseCacheControl);
    const manifestSeconds = Number(manifestCacheControl);

    expect(releaseCacheControl).toMatch(/^[0-9]+$/);
    expect(manifestCacheControl).toMatch(/^[0-9]+$/);
    expect(releaseSeconds).toBeGreaterThanOrEqual(2_592_000); // >= 30 days
    expect(manifestSeconds).toBeGreaterThan(0);
    expect(manifestSeconds).toBeLessThanOrEqual(300); // <= 5 minutes
    expect(releaseSeconds).toBeGreaterThan(manifestSeconds);
  });
});

// A10.26 — Real payload byte limit (RED contract).
// The limit must be checked against the exact bytes sent to Storage. For the
// manifest that means AFTER `releaseId` and the release file paths are part of
// the payload, measured as UTF-8 bytes — never against the pre-enrichment plan
// body. `releaseId` is the seam that lets these tests pin the finalized payload
// before any Storage call happens.
describe('real payload byte limit (A10.26 contract)', () => {
  type RecordedUpload = Readonly<{ file: CatalogJsonFileName; body: string }>;

  function recordingUpload(): Readonly<{
    upload: (file: CatalogJsonFileName, body: string) => Promise<{ error: unknown | null }>;
    calls: RecordedUpload[];
  }> {
    const calls: RecordedUpload[] = [];
    const upload = vi.fn(async (file: CatalogJsonFileName, body: string) => {
      calls.push({ file, body });
      return { error: null };
    });
    return { upload, calls };
  }

  function planManifestBody(): string {
    const documents = buildCatalogDocuments([card], [category], generatedAt);
    return catalogUploadPlan(documents)[2]!.body;
  }

  /**
   * Rebuilds the published manifest contract (releaseId + release paths) so a
   * test can state the byte/character boundary of the payload production is
   * expected to measure.
   */
  function finalizedManifest(
    baseManifestBody: string,
    releaseId: string,
  ): Readonly<{ bytes: number; chars: number }> {
    const document = JSON.parse(baseManifestBody) as Readonly<Record<string, unknown>>;
    const finalized = JSON.stringify({
      ...document,
      releaseId,
      files: {
        apps: `releases/${releaseId}/apps.json`,
        categories: `releases/${releaseId}/categories.json`,
      },
    });
    return { bytes: Buffer.byteLength(finalized, 'utf8'), chars: finalized.length };
  }

  it('publishes when the finalized manifest payload stays under the limit', async () => {
    const releaseId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const { upload, calls } = recordingUpload();
    const final = finalizedManifest(planManifestBody(), releaseId);
    expect(final.bytes).toBeLessThanOrEqual(CATALOG_JSON_BYTE_LIMIT);

    const result = await refreshCatalogJsonFiles(
      dependencies({ createReleaseId: () => releaseId, upload }),
    );

    expect(result.error).toBeNull();
    expect(calls.map(item => item.file)).toEqual([
      'apps.json',
      'categories.json',
      'manifest.json',
    ]);
    // The payload that passed the limit check is the finalized manifest.
    const uploaded = JSON.parse(calls[2]!.body) as Readonly<{
      releaseId?: string;
      files?: Readonly<{ apps?: string; categories?: string }>;
    }>;
    expect(uploaded.releaseId).toBe(releaseId);
    expect(uploaded.files).toEqual({
      apps: `releases/${releaseId}/apps.json`,
      categories: `releases/${releaseId}/categories.json`,
    });
    expect(Buffer.byteLength(calls[2]!.body, 'utf8')).toBeLessThanOrEqual(
      CATALOG_JSON_BYTE_LIMIT,
    );
  });

  it('fails before any upload when the finalized manifest exceeds the limit', async () => {
    const releaseId = 'a'.repeat(600_000);
    const base = planManifestBody();
    // The pre-enrichment plan body is far below the threshold, so only the
    // finalized payload (releaseId + release paths) can trigger the stop.
    expect(Buffer.byteLength(base, 'utf8')).toBeLessThan(CATALOG_JSON_BYTE_LIMIT);
    expect(finalizedManifest(base, releaseId).bytes).toBeGreaterThan(CATALOG_JSON_BYTE_LIMIT);
    const { upload } = recordingUpload();

    const result = await refreshCatalogJsonFiles(
      dependencies({ createReleaseId: () => releaseId, upload }),
    );

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('measures the finalized manifest as UTF-8 bytes rather than characters', async () => {
    // 'ğ' is 2 bytes in UTF-8: the finalized payload stays below the limit by
    // character count but exceeds it once encoded.
    const releaseId = 'ğ'.repeat(300_000);
    const final = finalizedManifest(planManifestBody(), releaseId);
    expect(final.chars).toBeLessThan(CATALOG_JSON_BYTE_LIMIT);
    expect(final.bytes).toBeGreaterThan(CATALOG_JSON_BYTE_LIMIT);
    const { upload } = recordingUpload();

    const result = await refreshCatalogJsonFiles(
      dependencies({ createReleaseId: () => releaseId, upload }),
    );

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('fails before any upload when the categories payload exceeds the limit', async () => {
    const { upload } = recordingUpload();
    const oversizedCategory: CatalogCategoryRow = {
      ...category,
      name: 'a'.repeat(CATALOG_JSON_BYTE_LIMIT),
    };
    const subject = dependencies({
      loadCategories: vi.fn(async () => ({ data: [oversizedCategory], error: null })),
      upload,
    });

    const result = await refreshCatalogJsonFiles(subject);

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(upload).not.toHaveBeenCalled();
  });
});

// A10.26 — the same contract observed through the REAL publish action, so the
// measurement, upload order, upsert flags and failure contract are checked on
// the path production actually runs (flag on, admin client + Storage mocked).
describe('real payload byte limit through the publish action (A10.26 contract)', () => {
  const FLAG = 'CATALOG_JSON_ENABLED';
  const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';
  const RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

  type StorageCall = Readonly<{
    file: string;
    body: string;
    options: Readonly<Record<string, unknown>> | undefined;
  }>;

  function harness(): Readonly<{
    action: ReturnType<typeof createCatalogRefreshAction>;
    calls: StorageCall[];
    upload: ReturnType<typeof vi.fn>;
    audits: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }> {
    const calls: StorageCall[] = [];
    const upload = vi.fn(
      async (file: string, body: string, options?: Record<string, unknown>) => {
        calls.push({ file, body, options });
        return { data: { path: file }, error: null };
      },
    );
    vi.doMock(ADMIN_CLIENT_MODULE, () => ({
      getAdminClient: vi.fn(() => ({
        from: mockFrom,
        storage: {
          from: () => ({ upload, download: async () => ({ data: null, error: null }) }),
        },
        rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
          catalogRpcResponse(name, args),
        ),
      })),
    }));
    const authorize = vi.fn(async () => ({ userId: 'u1' }) as never);
    const audits: Array<Readonly<Record<string, unknown>>> = [];
    const recordAudit = vi.fn(async (input: Readonly<Record<string, unknown>>) => {
      audits.push(input);
      return { error: null };
    });
    return {
      action: createCatalogRefreshAction(authorize as never, recordAudit as never),
      calls,
      upload,
      audits,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    delete process.env[FLAG];
    vi.doUnmock(ADMIN_CLIENT_MODULE);
    vi.restoreAllMocks();
  });

  it('keeps the release upload order and upsert flags with a finalized payload', async () => {
    const { action, calls } = harness();

    await expect(action()).resolves.toEqual({ error: null });

    const manifestCall = calls.find(item => item.file === 'manifest.json');
    expect(manifestCall).toBeDefined();
    const releaseId = (JSON.parse(manifestCall!.body) as { releaseId?: string }).releaseId;
    expect(releaseId).toMatch(RELEASE_ID_PATTERN);
    expect(calls.map(item => item.file)).toEqual([
      `releases/${releaseId}/apps.json`,
      `releases/${releaseId}/categories.json`,
      'manifest.json',
    ]);
    expect(calls.map(item => item.options?.upsert)).toEqual([false, false, true]);
  });

  it('stops with the internal error before any Storage call when the real manifest payload exceeds the limit', async () => {
    // Force the finalized manifest over the threshold while the plan body stays
    // far below it: only measuring the real payload can stop this publication.
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('a'.repeat(600_000) as never);
    const { action, calls, upload, audits } = harness();

    const result = await action();

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(upload).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    // The fixed public message and correlation id are returned; no payload or
    // release-path details may leak (correlationId derives from randomUUID).
    expect(JSON.stringify(result)).not.toContain('releases/');
    expect(result.error?.message).toBe('Beklenmeyen bir hata oluştu. Lütfen yeniden dene.');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ metadata: { code: 'INTERNAL' } });
  });
});

// A10.27 — Mandatory releaseId (RED contract).
// A v2 manifest without a usable `releaseId` is not a v2 manifest: the field
// must be required by the type AND enforced at runtime, so a caller without a
// release fails closed before finalization, measurement or any Storage call.
describe('releaseId requirement (A10.27 contract)', () => {
  const FLAG = 'CATALOG_JSON_ENABLED';
  const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';

  it('declares the release id factory as a required dependency (compile-time contract)', () => {
    const { createReleaseId: _omitted, ...incomplete } = dependencies();
    void _omitted;
    // @ts-expect-error A10.27/A10.34d: building refresh dependencies without
    // `createReleaseId` must be a compile-time error — the id is produced
    // inside the queued run, so callers cannot inject a stale one.
    const build = (): CatalogRefreshDependencies => incomplete;
    expect(typeof build).toBe('function');
  });

  const unusableReleaseIds: ReadonlyArray<readonly [string, unknown]> = [
    ['omitted', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
  ];

  it.each(unusableReleaseIds)(
    'refuses to publish when releaseId is %s',
    async (_label, value) => {
      const upload = vi.fn(async (_file: CatalogJsonFileName, _body: string) => ({
        error: null,
      }));
      const subject = dependencies({ createReleaseId: () => value as string, upload });

      const result = await refreshCatalogJsonFiles(subject);

      // Fail closed before finalization, the byte check and any Storage call:
      // no v2 manifest may be produced without a usable release id.
      expect(result.error).toMatchObject({ code: 'INTERNAL' });
      expect(upload).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('releases/');
    },
  );

  function harness(): Readonly<{
    action: ReturnType<typeof createCatalogRefreshAction>;
    calls: Array<{ file: string; body: string }>;
    upload: ReturnType<typeof vi.fn>;
    audits: Array<Readonly<Record<string, unknown>>>;
  }> {
    const calls: Array<{ file: string; body: string }> = [];
    const upload = vi.fn(async (file: string, body: string) => {
      calls.push({ file, body });
      return { data: { path: file }, error: null };
    });
    vi.doMock(ADMIN_CLIENT_MODULE, () => ({
      getAdminClient: vi.fn(() => ({
        from: mockFrom,
        storage: {
          from: () => ({ upload, download: async () => ({ data: null, error: null }) }),
        },
        rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
          catalogRpcResponse(name, args),
        ),
      })),
    }));
    const authorize = vi.fn(async () => ({ userId: 'u1' }) as never);
    const audits: Array<Readonly<Record<string, unknown>>> = [];
    const recordAudit = vi.fn(async (input: Readonly<Record<string, unknown>>) => {
      audits.push(input);
      return { error: null };
    });
    return {
      action: createCatalogRefreshAction(authorize as never, recordAudit as never),
      calls,
      upload,
      audits,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    delete process.env[FLAG];
    vi.doUnmock(ADMIN_CLIENT_MODULE);
    vi.restoreAllMocks();
  });

  it('stops without any Storage write when the publication cannot obtain a usable releaseId', async () => {
    // The production release id source itself yields an unusable value: the
    // action must fail closed instead of publishing a manifest without one.
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('' as never);
    const { action, calls, upload, audits } = harness();

    const result = await action();

    expect(result.error).toMatchObject({ code: 'INTERNAL' });
    expect(upload).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('releases/');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ metadata: { code: 'INTERNAL' } });
  });
});

// A10.34d — Publish lease + commit RPC integration (RED contract).
// The database already owns the lease and commit contract (A10.34b/c). This
// block proves the admin producer drives that contract in the documented
// order, with the manifest payload as the single source of commit values.
describe('publish lease and commit integration (A10.34d contract)', () => {
  const FLAG = 'CATALOG_JSON_ENABLED';
  const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';
  const RELEASE_APPS = /^releases\/[A-Za-z0-9_-]{8,64}\/apps\.json$/;
  const RELEASE_CATEGORIES = /^releases\/[A-Za-z0-9_-]{8,64}\/categories\.json$/;

  type RpcCall = Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>;

  const publishOrder = Object.freeze([
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

  /**
   * A full dependency set whose every publish step records when it ran, so a
   * single assertion can prove the whole order (lease before reads, renew
   * before the manifest, commit last).
   */
  function recordingDependencies(
    log: string[],
    overrides: Partial<CatalogRefreshDependencies> = {},
    prefix = '',
  ): CatalogRefreshDependencies {
    const mark = (step: string) => {
      log.push(prefix ? `${prefix}:${step}` : step);
    };
    return dependencies({
      createOperationId: () => {
        mark('operation_id');
        return operationId;
      },
      getIntent: vi.fn(async () => {
        mark('get_intent');
        return { data: null, error: null };
      }),
      createReleaseId: () => {
        mark('release_id');
        return defaultReleaseId;
      },
      loadPublishState: vi.fn(async () => {
        mark('load_state');
        return {
          data: {
            generation: 0,
            leaseToken: null,
            leaseExpiresAt: null,
            leaseOperationId: null,
            leaseAttemptId: null,
          },
          error: null,
        };
      }),
      beginIntent: vi.fn(async () => {
        mark('begin');
        return {
          data: {
            operationId,
            releaseId: defaultReleaseId,
            status: 'in_progress',
            expectedGeneration: 0,
            payloadDigest: null,
            attemptId: null,
            sealedAt: null,
            idempotent: false,
          },
          error: null,
        };
      }),
      acquireLease: vi.fn(async () => {
        mark('acquire');
        return {
          data: { leaseToken, leaseExpiresAt, stateGeneration: 0 },
          error: null,
        };
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
      assertLease: vi.fn(async () => {
        mark('assert');
        return { data: true, error: null };
      }),
      upload: vi.fn(async (file: CatalogJsonFileName) => {
        mark(`upload:${file}`);
        return { error: null };
      }),
      renewLease: vi.fn(async () => {
        mark('renew');
        return { error: null };
      }),
      commit: vi.fn(async () => {
        mark('commit');
        return {
          data: {
            releaseId: defaultReleaseId,
            generation: 1,
            committedAt,
            idempotent: false,
            outcome: 'committed' as const,
            failureCode: null,
          },
          error: null,
        };
      }),
      releaseLease: vi.fn(async () => {
        mark('release');
        return { error: null };
      }),
      ...overrides,
    });
  }

  it('runs the publish steps in the committed order', async () => {
    const log: string[] = [];

    const result = await refreshCatalogJsonFiles(recordingDependencies(log));

    expect(result.error).toBeNull();
    expect(log).toEqual(publishOrder);
    // The lease is cleared by a successful commit; releasing again would be a
    // needless call against a lease this run no longer owns.
    expect(log).not.toContain('release');
  });

  it('does not read the catalog or upload anything when the lease cannot be acquired', async () => {
    const log: string[] = [];
    const upload = vi.fn(async () => ({ error: null }));
    const commit = vi.fn(async () => ({ data: null, error: null }));

    const result = await refreshCatalogJsonFiles(
      recordingDependencies(log, {
        acquireLease: vi.fn(async () => {
          log.push('acquire');
          return { data: null, error: { code: 'CDP01', message: 'lease busy' } };
        }),
        upload,
        commit,
      }),
    );

    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
    expect(upload).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    // No lease was held, so there is nothing to release.
    expect(log).toEqual(['operation_id', 'get_intent', 'release_id', 'load_state', 'begin', 'acquire']);
    expect(JSON.stringify(result)).toContain('İşlem geçici olarak tamamlanamadı');
  });

  it.each([
    ['apps', 'apps.json', ['apps.json']],
    ['categories', 'categories.json', ['apps.json', 'categories.json']],
  ] as const)(
    'stops at the failed %s upload without manifest or commit and releases the lease',
    async (_label, failing, expectedUploads) => {
      const uploads: string[] = [];
      const commit = vi.fn(async () => ({ data: null, error: null }));
      const releaseLease = vi.fn(async () => ({ error: null }));
      const log: string[] = [];

      const result = await refreshCatalogJsonFiles(
        recordingDependencies(log, {
          upload: vi.fn(async (file: CatalogJsonFileName) => {
            uploads.push(file);
            return { error: file === failing ? { message: 'storage down' } : null };
          }),
          commit,
          releaseLease,
        }),
      );

      expect(result.error).toMatchObject({ code: 'TEMPORARY' });
      expect(uploads).toEqual(expectedUploads);
      expect(commit).not.toHaveBeenCalled();
      expect(releaseLease).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(leaseToken);
      expect(JSON.stringify(result)).not.toContain('storage down');
    },
  );

  it('never writes the manifest or commits when the lease renewal fails', async () => {
    const uploads: string[] = [];
    const commit = vi.fn(async () => ({ data: null, error: null }));
    const releaseLease = vi.fn(async () => ({ error: null }));

    const result = await refreshCatalogJsonFiles(
      recordingDependencies([], {
        upload: vi.fn(async (file: CatalogJsonFileName) => {
          uploads.push(file);
          return { error: null };
        }),
        renewLease: vi.fn(async () => ({
          error: { code: 'CDP02', message: 'lease expired' },
        })),
        commit,
        releaseLease,
      }),
    );

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(uploads).toEqual(['apps.json', 'categories.json']);
    expect(commit).not.toHaveBeenCalled();
    expect(releaseLease).toHaveBeenCalledTimes(1);
  });

  it('commits exactly the published manifest with the generation from acquire', async () => {
    const log: string[] = [];
    let committed: CatalogPublishCommitInput | undefined;
    let manifestBody = '';
    const upload = vi.fn(async (file: CatalogJsonFileName, body: string) => {
      if (file === 'manifest.json') manifestBody = body;
      log.push(`upload:${file}`);
      return { error: null };
    });
    const acquireLease = vi.fn(async () => ({
      data: { leaseToken, leaseExpiresAt, stateGeneration: 42 },
      error: null,
    }));
    const commit = vi.fn(async (input: CatalogPublishCommitInput) => {
      committed = input;
      return {
        data: {
          releaseId: input.releaseId,
          generation: 43,
          committedAt,
          idempotent: false,
          outcome: 'committed' as const,
          failureCode: null,
        },
        error: null,
      };
    });

    const result = await refreshCatalogJsonFiles(
      recordingDependencies(log, { upload, acquireLease, commit }),
    );

    expect(result.error).toBeNull();
    const manifest = JSON.parse(manifestBody) as Readonly<{
      releaseId: string;
      generatedAt: string;
      appCount: number;
      categoryCount: number;
    }>;
    expect(manifest.releaseId).toBe(defaultReleaseId);
    expect(manifest.generatedAt).toBe(generatedAt);
    expect(manifest.appCount).toBe(1);
    expect(manifest.categoryCount).toBe(1);
    // Nothing is recomputed between the manifest and the commit: every value
    // below is the exact value the manifest carries (or the acquire response).
    expect(committed).toEqual({
      operationId,
      leaseToken,
      attemptId: derivePublishAttemptId(operationId),
      actorId,
      expectedGeneration: 42,
      releaseId: manifest.releaseId,
      generatedAt: manifest.generatedAt,
      appCount: manifest.appCount,
      categoryCount: manifest.categoryCount,
    });
  });

  const sqlStateCases: ReadonlyArray<readonly [string, string]> = [
    ['CDP01', 'TEMPORARY'],
    ['CDP02', 'CONFLICT'],
    ['CDP03', 'CONFLICT'],
    ['CDP04', 'TEMPORARY'],
    ['CDP05', 'CONFLICT'],
    ['CDP06', 'CONFLICT'],
    ['CDP07', 'CONFLICT'],
    ['55P03', 'TEMPORARY'],
    ['22004', 'VALIDATION'],
    ['22023', 'VALIDATION'],
    ['P0001', 'FORBIDDEN'],
  ];

  it.each(sqlStateCases)(
    'maps commit SQLSTATE %s to %s without retrying',
    async (sqlState, expected) => {
      const commit = vi.fn(async () => ({
        data: null,
        error: { code: sqlState, message: 'database rejected the commit' },
      }));

      const result = await refreshCatalogJsonFiles(
        recordingDependencies([], { commit }),
      );

      expect(result.error).toMatchObject({ code: expected });
      expect(commit).toHaveBeenCalledTimes(1);
      // P0001 is an unexpected database/authorization failure, never a user
      // input error; only 22004/22023 may surface as VALIDATION.
      if (sqlState === 'P0001') {
        expect(result.error?.code).not.toBe('VALIDATION');
      }
    },
  );

  const retryCases: ReadonlyArray<
    readonly [string, unknown, number, string | null]
  > = [
    ['transport failure', new TypeError('fetch failed'), 2, null],
    ['HTTP 503', { status: 503, message: 'unavailable' }, 2, null],
    ['SQLSTATE CDP06', { code: 'CDP06', message: 'stale' }, 1, 'CONFLICT'],
    ['HTTP 400', { status: 400, message: 'bad request' }, 1, 'INTERNAL'],
  ];

  it.each(retryCases)(
    'retries only ambiguous commit failures: %s',
    async (_label, failure, expectedCalls, expectedCode) => {
      const calls: CatalogPublishCommitInput[] = [];
      let attempt = 0;
      const commit = vi.fn(async (input: CatalogPublishCommitInput) => {
        calls.push(input);
        attempt += 1;
        if (attempt === 1) return { data: null, error: failure };
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
      const releaseLease = vi.fn(async () => ({ error: null }));
      const log: string[] = [];

      const result = await refreshCatalogJsonFiles(
        recordingDependencies(log, { commit, releaseLease }),
      );

      expect(commit).toHaveBeenCalledTimes(expectedCalls);
      // A commit retry never re-runs the uploads: the manifest is written once
      // and only after a successful commit.
      expect(log.filter(step => step === 'upload:manifest.json')).toHaveLength(
        expectedCalls === 2 ? 1 : 0,
      );
      if (expectedCalls === 2) {
        // Identical parameters: no new release id, timestamp or counts.
        expect(calls[1]).toEqual(calls[0]);
        expect(result.error).toBeNull();
        expect(releaseLease).not.toHaveBeenCalled();
      } else {
        expect(result.error).toMatchObject({ code: expectedCode });
        expect(releaseLease).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('releases the lease best-effort when the retried commit also fails', async () => {
    const commit = vi.fn(async () => ({
      data: null,
      error: new TypeError('fetch failed'),
    }));
    const releaseLease = vi.fn(async () => ({ error: { code: 'CDP03' } }));

    const result = await refreshCatalogJsonFiles(
      recordingDependencies([], { commit, releaseLease }),
    );

    expect(commit).toHaveBeenCalledTimes(2);
    expect(releaseLease).toHaveBeenCalledTimes(1);
    // The cleanup failure must not replace the publication failure.
    expect(result.error).toMatchObject({ code: 'TEMPORARY' });
  });

  it('serializes two same-process refreshes so their steps never interleave', async () => {
    const log: string[] = [];

    const [first, second] = await Promise.all([
      refreshCatalogJsonFiles(recordingDependencies(log, {}, 'a')),
      refreshCatalogJsonFiles(recordingDependencies(log, {}, 'b')),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(log).toEqual([
      ...publishOrder.map(step => `a:${step}`),
      ...publishOrder.map(step => `b:${step}`),
    ]);
  });

  type ActionHarness = Readonly<{
    action: ReturnType<typeof createCatalogRefreshAction>;
    authorize: ReturnType<typeof vi.fn>;
    rpcCalls: RpcCall[];
    uploads: Array<Readonly<{ file: string; body: string }>>;
    audits: Array<Readonly<Record<string, unknown>>>;
  }>;

  /**
   * Runs the REAL action against a mocked admin client so the RPC wiring and
   * the audit path are exercised exactly as production does.
   */
  function actionHarness(
    spec: Readonly<{
      rpcHandler?: (
        name: string,
        args: Readonly<Record<string, unknown>>,
      ) => Readonly<{ data: unknown; error: unknown }> | undefined;
    }> = {},
  ): ActionHarness {
    const rpcCalls: RpcCall[] = [];
    const uploads: Array<Readonly<{ file: string; body: string }>> = [];
    const upload = vi.fn(async (file: string, body: string) => {
      uploads.push({ file, body });
      return { data: { path: file }, error: null };
    });
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return spec.rpcHandler?.(name, args) ?? catalogRpcResponse(name, args);
    });
    vi.doMock(ADMIN_CLIENT_MODULE, () => ({
      getAdminClient: vi.fn(() => ({
        from: mockFrom,
        storage: {
          from: () => ({ upload, download: async () => ({ data: null, error: null }) }),
        },
        rpc,
      })),
    }));
    const authorize = vi.fn(async () => ({ userId: actorId }) as never);
    const audits: Array<Readonly<Record<string, unknown>>> = [];
    const recordAudit = vi.fn(async (input: Readonly<Record<string, unknown>>) => {
      audits.push(input);
      return { error: null };
    });
    return {
      action: createCatalogRefreshAction(authorize as never, recordAudit as never),
      authorize,
      rpcCalls,
      uploads,
      audits,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    delete process.env[FLAG];
    vi.doUnmock(ADMIN_CLIENT_MODULE);
    vi.restoreAllMocks();
  });

  it('performs no RPC, Storage, or audit call while the flag is off', async () => {
    delete process.env[FLAG];
    const { action, authorize, rpcCalls, uploads, audits } = actionHarness();

    await expect(action()).resolves.toEqual({ error: null });

    expect(authorize).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('acquires and renews with one lease duration and commits the published manifest', async () => {
    const stateGeneration = 7;
    const { action, rpcCalls, uploads } = actionHarness({
      rpcHandler: (name) => {
        if (name !== 'acquire_catalog_publish_lease') return undefined;
        return {
          data: [
            {
              lease_token: leaseToken,
              lease_expires_at: leaseExpiresAt,
              state_generation: stateGeneration,
              idempotent: false,
            },
          ],
          error: null,
        };
      },
    });

    await expect(action()).resolves.toEqual({ error: null });

    const acquire = rpcCalls.find(call => call.name === 'acquire_catalog_publish_lease');
    const renew = rpcCalls.find(call => call.name === 'renew_catalog_publish_lease');
    const commit = rpcCalls.find(call => call.name === 'commit_catalog_publish');
    expect(acquire).toBeDefined();
    expect(renew).toBeDefined();
    expect(commit).toBeDefined();
    expect(CATALOG_PUBLISH_LEASE_SECONDS).toBeGreaterThanOrEqual(30);
    expect(CATALOG_PUBLISH_LEASE_SECONDS).toBeLessThanOrEqual(900);
    expect(acquire!.args.p_lease_seconds).toBe(CATALOG_PUBLISH_LEASE_SECONDS);
    expect(renew!.args.p_lease_seconds).toBe(CATALOG_PUBLISH_LEASE_SECONDS);
    expect(renew!.args.p_lease_token).toBe(leaseToken);

    const manifestJson = uploads.find(item => item.file === 'manifest.json');
    expect(manifestJson).toBeDefined();
    const manifest = JSON.parse(manifestJson!.body) as Readonly<{
      releaseId: string;
      generatedAt: string;
      appCount: number;
      categoryCount: number;
    }>;
    expect(commit!.args).toEqual({
      p_operation_id: acquire!.args.p_operation_id,
      p_lease_token: leaseToken,
      p_actor_id: actorId,
      p_expected_generation: stateGeneration,
      p_release_id: manifest.releaseId,
      p_generated_at: manifest.generatedAt,
      p_app_count: manifest.appCount,
      p_category_count: manifest.categoryCount,
      p_attempt_id: derivePublishAttemptId(String(acquire!.args.p_operation_id)),
    });
    // The publish lease is committed away, never released by the producer; the
    // manifest claim is a separate S8 fence and is released last.
    expect(rpcCalls.at(-1)!.name).toBe('release_catalog_manifest_claim');
    expect(
      rpcCalls.findIndex(call => call.name === 'commit_catalog_publish'),
    ).toBeLessThan(
      rpcCalls.findIndex(call => call.name === 'claim_catalog_manifest'),
    );
    expect(
      rpcCalls.some(call => call.name === 'release_catalog_publish_lease'),
    ).toBe(false);
  });

  it('never exposes the lease token in the returned error or audit metadata', async () => {
    const { action, rpcCalls, uploads, audits } = actionHarness({
      rpcHandler: (name) =>
        name === 'commit_catalog_publish'
          ? {
              data: null,
              error: { code: 'CDP03', message: `lease ${leaseToken} is not yours` },
            }
          : undefined,
    });

    const result = await action();

    expect(result.error).toMatchObject({ code: 'CONFLICT' });
    expect(result.error?.message).not.toContain(leaseToken);
    expect(JSON.stringify(result)).not.toContain(leaseToken);
    expect(uploads.map(item => item.file)).toEqual([
      expect.stringMatching(RELEASE_APPS),
      expect.stringMatching(RELEASE_CATEGORIES),
    ]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ metadata: { code: 'CONFLICT' } });
    expect(JSON.stringify(audits)).not.toContain(leaseToken);
    // A failed commit still owns the lease, so it is released best-effort.
    const release = rpcCalls.find(
      call => call.name === 'release_catalog_publish_lease',
    );
    expect(release).toBeDefined();
    expect(release!.args.p_lease_token).toBe(leaseToken);
    expect(release!.args.p_attempt_id).toBe(
      derivePublishAttemptId(String(release!.args.p_operation_id)),
    );
  });
});

// A10.36 S1 — deterministic catalog production.
// A publish digest is only meaningful when the same logical catalog always
// serializes to the same bytes, so both the document builder and the Supabase
// reads must be order-independent. The builder sorts defensively; the queries
// ask for the same order explicitly.
describe('deterministic catalog production (A10.36 S1)', () => {
  const ADDRESS = 'b2000000-0000-4000-8000-';
  const CATEGORY = 'c3000000-0000-4000-8000-';

  const laterCard: CatalogCardRow = {
    ...card,
    app_id: `${ADDRESS}000000000002`,
    slug: 'ikinci',
  };
  const earlierCard: CatalogCardRow = {
    ...card,
    app_id: `${ADDRESS}000000000001`,
    slug: 'birinci',
  };

  const positionTwo: CatalogCategoryRow = {
    id: `${CATEGORY}000000000002`,
    slug: 'iki',
    name: 'İki',
    position: 2,
  };
  const positionOneLater: CatalogCategoryRow = {
    id: `${CATEGORY}000000000003`,
    slug: 'uc',
    name: 'Üç',
    position: 1,
  };
  const positionOneEarlier: CatalogCategoryRow = {
    id: `${CATEGORY}000000000001`,
    slug: 'bir',
    name: 'Bir',
    position: 1,
  };

  it('orders apps by app_id regardless of the input order', () => {
    const documents = buildCatalogDocuments(
      [laterCard, earlierCard],
      [positionTwo, positionOneLater, positionOneEarlier],
      generatedAt,
    );

    expect(documents.apps.apps.map(row => row.app_id)).toEqual([
      earlierCard.app_id,
      laterCard.app_id,
    ]);
  });

  it('orders categories by position and breaks ties by id', () => {
    const documents = buildCatalogDocuments(
      [card],
      [positionTwo, positionOneLater, positionOneEarlier],
      generatedAt,
    );

    expect(documents.categories.categories.map(row => row.id)).toEqual([
      positionOneEarlier.id,
      positionOneLater.id,
      positionTwo.id,
    ]);
  });

  it('produces byte-identical upload plans for the same set in a different order', () => {
    const first = catalogUploadPlan(
      buildCatalogDocuments(
        [laterCard, earlierCard],
        [positionTwo, positionOneEarlier, positionOneLater],
        generatedAt,
      ),
    );
    const second = catalogUploadPlan(
      buildCatalogDocuments(
        [earlierCard, laterCard],
        [positionOneLater, positionTwo, positionOneEarlier],
        generatedAt,
      ),
    );

    expect(first.map(item => item.body)).toEqual(second.map(item => item.body));
  });

  it('does not mutate the caller arrays while ordering', () => {
    const cards: CatalogCardRow[] = [laterCard, earlierCard];
    const categories: CatalogCategoryRow[] = [positionTwo, positionOneEarlier];

    buildCatalogDocuments(cards, categories, generatedAt);

    expect(cards).toEqual([laterCard, earlierCard]);
    expect(categories).toEqual([positionTwo, positionOneEarlier]);
  });

  it('asks the database for the same explicit order', async () => {
    const ADMIN_CLIENT_MODULE = '../../server/supabase/admin-client';
    const cardOrders: unknown[][] = [];
    const categoryOrders: unknown[][] = [];

    vi.resetModules();
    process.env.CATALOG_JSON_ENABLED = 'true';
    try {
      vi.doMock(ADMIN_CLIENT_MODULE, () => ({
        getAdminClient: vi.fn(() => ({
          from: (table: string) =>
            table === 'catalog_publish_state'
              ? mockFrom(table)
              : table === 'catalog_app_cards'
                ? {
                    select: () => ({
                      order: async (...args: unknown[]) => {
                        cardOrders.push(args);
                        return { data: [card], error: null };
                      },
                    }),
                  }
                : {
                    select: () => ({
                      eq: () => ({
                        order: (...args: unknown[]) => ({
                          order: async (...second: unknown[]) => {
                            categoryOrders.push(args, second);
                            return { data: [category], error: null };
                          },
                        }),
                      }),
                    }),
                  },
          storage: {
            from: () => ({
              upload: vi.fn(async () => ({ error: null })),
              download: async () => ({ data: null, error: null }),
            }),
          },
          rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
            catalogRpcResponse(name, args),
          ),
        })),
      }));

      const action = createCatalogRefreshAction(
        vi.fn(async () => ({ userId: 'u1' }) as never),
      );

      await expect(action()).resolves.toEqual({ error: null });
      expect(cardOrders).toEqual([['app_id', { ascending: true }]]);
      expect(categoryOrders).toEqual([
        ['position', { ascending: true }],
        ['id', { ascending: true }],
      ]);
    } finally {
      delete process.env.CATALOG_JSON_ENABLED;
      vi.doUnmock(ADMIN_CLIENT_MODULE);
    }
  });
});
