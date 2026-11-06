// @vitest-environment node

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CleanupWorkerDependencies } from './cleanup-worker';

vi.mock('server-only', () => ({}));

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && loopbackHosts.has(url.hostname);
  } catch {
    return false;
  }
}

const supabaseUrl = (process.env.SUPABASE_TEST_URL ?? '').trim();
const serviceRoleKey = (process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? '').trim();

if (supabaseUrl && !isLoopbackUrl(supabaseUrl)) {
  throw new Error(
    'F06-3 entegrasyon testi yalnızca loopback Supabase URL ile çalışır; production reddedildi.',
  );
}

const enabled = isLoopbackUrl(supabaseUrl) && serviceRoleKey.length > 0;

/**
 * F06-3: verifies against the real local Supabase Storage API that a delete
 * addressed to an older object version cannot remove the current object at
 * the same path. The test creates its own bucket, never touches production,
 * and removes every object and bucket it created in `afterAll`.
 *
 * Run with:
 *   SUPABASE_TEST_URL="$API_URL" \
 *   SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
 *   npx vitest run src/features/uploads/storage-object-version.integration.test.ts
 *
 * Without both variables the suite is skipped, so ordinary offline runs stay
 * green without pretending the integration test passed.
 */
describe.skipIf(!enabled)('real Supabase Storage object versions (F06-3)', () => {
  const bucket = `f06-3-version-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const created = new Map<string, Set<string>>();
  let storage: ReturnType<typeof createClient>['storage'];
  let removeObject: CleanupWorkerDependencies['removeObject'];

  function track(path: string, version?: string): void {
    const versions = created.get(path) ?? new Set<string>();
    if (version) versions.add(version);
    created.set(path, versions);
  }

  async function versionOf(path: string): Promise<string> {
    const { data, error } = await storage.from(bucket).info(path);
    if (error || !data) {
      throw new Error(`info() başarısız (${path}): ${error?.message ?? 'veri yok'}`);
    }
    if (typeof data.version !== 'string' || data.version.length === 0) {
      throw new Error(`info() geçerli bir version döndürmedi (${path}).`);
    }
    return data.version;
  }

  async function upload(path: string, body: string): Promise<string> {
    const { error } = await storage
      .from(bucket)
      .upload(path, body, { upsert: true, contentType: 'text/plain' });
    if (error) throw new Error(`upload() başarısız (${path}): ${error.message}`);

    const version = await versionOf(path);
    track(path, version);
    return version;
  }

  async function downloadText(path: string): Promise<string> {
    const { data, error } = await storage.from(bucket).download(path);
    if (error || !data) {
      throw new Error(`download() başarısız (${path}): ${error?.message ?? 'veri yok'}`);
    }
    return data.text();
  }

  beforeAll(async () => {
    // cleanup-service reads its own env; point it at the same local stack so
    // its real removeObject implementation is exercised, not reimplemented.
    process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = serviceRoleKey;
    process.env.NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:3000';
    process.env.SUPABASE_SECRET_KEY = serviceRoleKey;

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    storage = client.storage;

    const { error } = await storage.createBucket(bucket, { public: false });
    if (error) throw new Error(`Test bucket oluşturulamadı: ${error.message}`);

    const { workerDependencies } = await import('./cleanup-service');
    removeObject = workerDependencies().removeObject;
  });

  afterAll(async () => {
    if (!storage) return;

    const cleanupErrors: string[] = [];

    for (const [path, versions] of created) {
      for (const version of versions) {
        const { error } = await storage
          .from(bucket)
          .remove([{ path, versionId: version }]);
        if (error && !/not.?found|does not exist/i.test(error.message ?? '')) {
          cleanupErrors.push(`${path}@${version}: ${error.message}`);
        }
      }
    }

    // Never leave a test object behind, even if version lookup failed above.
    for (const path of created.keys()) {
      const { error } = await storage.from(bucket).info(path);
      if (error) continue;

      const removal = await storage.from(bucket).remove([path]);
      if (removal.error) {
        cleanupErrors.push(`${path}: ${removal.error.message}`);
        continue;
      }
      const recheck = await storage.from(bucket).info(path);
      if (!recheck.error) cleanupErrors.push(`${path}: nesne silinemedi`);
    }

    const bucketRemoval = await storage.deleteBucket(bucket);
    if (bucketRemoval.error) {
      cleanupErrors.push(`bucket ${bucket}: ${bucketRemoval.error.message}`);
    }

    if (cleanupErrors.length > 0) {
      throw new Error(
        `F06-3 test temizliği başarısız (bucket=${bucket}): ${cleanupErrors.join('; ')}`,
      );
    }
  });

  it('deletes only the addressed version and leaves the newer object downloadable', async () => {
    const path = `cases/${randomUUID()}/probe.txt`;
    track(path);

    const v1 = await upload(path, 'v1-content');
    const v2 = await upload(path, 'v2-content');

    expect(v2).not.toBe(v1);

    const staleDelete = await storage
      .from(bucket)
      .remove([{ path, versionId: v1 }]);
    expect(staleDelete.error).toBeNull();
    expect(staleDelete.data).toEqual([]);

    const currentInfo = await storage.from(bucket).info(path);
    expect(currentInfo.error).toBeNull();
    expect(currentInfo.data?.version).toBe(v2);
    expect(await downloadText(path)).toBe('v2-content');

    // The production cleanup-service removeObject, against the same real API.
    await expect(removeObject(bucket, path, v2)).resolves.toEqual({
      error: null,
      removed: true,
    });

    const afterRemoval = await storage.from(bucket).info(path);
    expect(afterRemoval.data).toBeNull();
    expect(afterRemoval.error).not.toBeNull();
  });

  it('returns an empty result for an unknown version id and keeps the object', async () => {
    const path = `cases/${randomUUID()}/probe.txt`;
    track(path);

    const version = await upload(path, 'kept-content');
    const unknown = randomUUID();

    const result = await storage
      .from(bucket)
      .remove([{ path, versionId: unknown }]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);

    expect(await versionOf(path)).toBe(version);
    expect(await downloadText(path)).toBe('kept-content');

    // data: [] maps to a safe, non-error worker result.
    await expect(removeObject(bucket, path, unknown)).resolves.toEqual({
      error: null,
      removed: false,
    });
  });

  it('reports a real Storage API error instead of a successful removal', async () => {
    // Local Storage answers an unknown bucket/path with `data: []`, so force a
    // real validation error through the same production removeObject path.
    const result = await removeObject('', 'probe.txt', randomUUID());

    expect(result.removed).toBe(false);
    expect(result.error).not.toBeNull();
  });
});
