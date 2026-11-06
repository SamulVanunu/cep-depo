import 'server-only';

import { getServerEnv } from '../../lib/env';
import { getServiceClient } from '../../server/supabase/service-client';
import { checkCleanupObject } from '../cleanup/cleanup-admin-storage';
import {
  isCatalogReleaseRetained,
  isLiveCatalogReference,
  readCatalogReferenceKeys,
  type CatalogPointer,
  type CatalogReferenceSources,
} from './live-catalog';
import { CLEANUP_BUCKETS, type SweepBucket } from './cleanup-paths';
import type { CleanupHandlerDependencies } from './cleanup-http';
import {
  runCleanupSweep,
  type SweepCursor,
  type SweepDependencies,
} from './cleanup-sweeper';
import {
  runCleanupBatch,
  type CleanupJob,
  type CleanupWorkerDependencies,
} from './cleanup-worker';

const WORKER_ID_SAFE = /[^a-z0-9._-]/g;

export function createWorkerId(): string {
  const deployment = (process.env.VERCEL_DEPLOYMENT_ID ?? 'local')
    .toLowerCase()
    .replace(WORKER_ID_SAFE, '-')
    .slice(0, 40);

  return `cleanup-${deployment}-${crypto.randomUUID().slice(0, 8)}`;
}

function catalogReferenceSources(
  client: ReturnType<typeof getServiceClient>,
): CatalogReferenceSources {
  // One read per worker run. Each failed read clears its cache entry so the
  // next job retries instead of reusing a broken answer.
  let pointerPromise: Promise<CatalogPointer> | null = null;
  const releasePromises = new Map<number, Promise<readonly string[]>>();
  const existsPromises = new Map<string, Promise<boolean>>();

  return {
    pointer(): Promise<CatalogPointer> {
      pointerPromise ??= (async (): Promise<CatalogPointer> => {
        const { data, error } = await client.rpc('get_catalog_pointer');
        if (error) throw error;

        const row = data?.[0];
        if (!row) throw new Error('Katalog pointer satırı döndürmedi.');
        if (
          typeof row.generation !== 'number' ||
          typeof row.retained_from_generation !== 'number' ||
          (row.release_id !== null && typeof row.release_id !== 'string')
        ) {
          throw new Error('Katalog pointer yanıtı geçersiz.');
        }

        return {
          generation: row.generation,
          releaseId: row.release_id,
          retainedFromGeneration: row.retained_from_generation,
          reconciliationRequired: row.reconciliation_required === true,
        };
      })().catch(error => {
        pointerPromise = null;
        throw error;
      });

      return pointerPromise;
    },

    retainedReleases(fromGeneration: number): Promise<readonly string[]> {
      let pending = releasePromises.get(fromGeneration);
      if (!pending) {
        pending = (async () => {
          const { data, error } = await client
            .from('catalog_publish_history')
            .select('release_id')
            .gte('generation', fromGeneration);
          if (error) throw error;

          return [...new Set((data ?? []).map(row => row.release_id))];
        })().catch(error => {
          releasePromises.delete(fromGeneration);
          throw error;
        });
        releasePromises.set(fromGeneration, pending);
      }

      return pending;
    },

    releaseExists(releaseId: string): Promise<boolean> {
      let pending = existsPromises.get(releaseId);
      if (!pending) {
        pending = (async () => {
          const { data, error } = await client
            .from('catalog_publish_history')
            .select('id')
            .eq('release_id', releaseId)
            .limit(1);
          if (error) throw error;

          return (data ?? []).length > 0;
        })().catch(error => {
          existsPromises.delete(releaseId);
          throw error;
        });
        existsPromises.set(releaseId, pending);
      }

      return pending;
    },
  };
}

export function workerDependencies(): CleanupWorkerDependencies {
  const client = getServiceClient();
  // One read per worker run. A failure clears the cache so the next job (and
  // the next run) retries instead of reusing a broken answer.
  const catalogSources = catalogReferenceSources(client);
  let catalogReferences: Promise<ReadonlySet<string>> | null = null;
  const catalogRetention = new Map<string, Promise<boolean>>();

  function catalogKeys(): Promise<ReadonlySet<string>> {
    catalogReferences ??= readCatalogReferenceKeys(client, {
      sources: catalogSources,
    }).catch(error => {
      catalogReferences = null;
      throw error;
    });
    return catalogReferences;
  }

  return {
    async claimJobs(input): Promise<readonly CleanupJob[]> {
      const { data, error } = await client.rpc('cleanup_claim_jobs', {
        p_worker_id: input.workerId,
        p_limit: input.limit,
        p_lease_seconds: input.leaseSeconds,
      });
      if (error) throw error;

      return (data ?? []).map(row => ({
        jobId: row.job_id,
        bucket: row.bucket,
        path: row.path,
        targetType: row.target_type,
        attempts: row.attempts,
        leaseToken: row.lease_token,
        storageVersion: row.storage_version ?? null,
      }));
    },

    async startJob(jobId, workerId, leaseToken): Promise<number> {
      const { data, error } = await client.rpc('cleanup_start_job', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_lease_token: leaseToken,
      });
      if (error) throw error;
      if (typeof data !== 'number') {
        throw new Error('cleanup_start_job beklenmeyen bir sonuç döndürdü.');
      }

      return data;
    },

    async isReferenced(bucket, path): Promise<boolean> {
      const { data, error } = await client.rpc('cleanup_asset_is_referenced', {
        p_bucket: bucket,
        p_path: path,
      });
      if (error) throw error;

      return data === true;
    },

    async isCatalogReferenced(bucket, path): Promise<boolean> {
      // The guard lives in the pure helper so `catalog` can never be answered
      // with a silent `false` from this path.
      return isLiveCatalogReference(bucket, path, catalogKeys);
    },

    async isCatalogReleaseRetained(releaseId): Promise<boolean> {
      let pending = catalogRetention.get(releaseId);
      if (!pending) {
        pending = isCatalogReleaseRetained(releaseId, catalogSources).catch(error => {
          catalogRetention.delete(releaseId);
          throw error;
        });
        catalogRetention.set(releaseId, pending);
      }

      return pending;
    },

    async inspectObject(bucket, path) {
      return checkCleanupObject(client, bucket, path);
    },

    async removeObject(bucket, path, version) {
      const { data, error } = await client.storage
        .from(bucket)
        .remove([{ path, versionId: version }]);
      return { error, removed: Array.isArray(data) && data.length > 0 };
    },

    async completeJob(jobId, workerId): Promise<void> {
      const { error } = await client.rpc('cleanup_complete_job', {
        p_job_id: jobId,
        p_worker_id: workerId,
      });
      if (error) throw error;
    },

    async failJob(jobId, workerId, error) {
      const { data, error: rpcError } = await client.rpc('cleanup_fail_job', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_error: error,
      });
      if (rpcError) throw rpcError;

      const row = data?.[0];
      if (!row || typeof row.quarantined !== 'boolean') {
        throw new Error('cleanup_fail_job beklenmeyen bir sonuç döndürdü.');
      }

      return { quarantined: row.quarantined };
    },

    async skipJob(jobId, workerId, reason) {
      const { data, error } = await client.rpc('cleanup_skip_job', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_reason: reason,
      });
      if (error) throw error;

      if (data !== 'skipped' && data !== 'quarantined') {
        throw new Error('cleanup_skip_job beklenmeyen bir sonuç döndürdü.');
      }

      return data;
    },

    async releaseJob(jobId, workerId, leaseToken): Promise<void> {
      const { data, error } = await client.rpc('cleanup_release_job', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_lease_token: leaseToken,
      });
      if (error) throw error;
      if (data !== true) {
        throw new Error('cleanup_release_job beklenmeyen bir sonuç döndürdü.');
      }
    },
  };
}

async function runWorker() {
  const workerId = createWorkerId();
  return runCleanupBatch(workerDependencies(), workerId);
}

function cursorBucket(value: string): SweepBucket {
  return (CLEANUP_BUCKETS as readonly string[]).includes(value)
    ? (value as SweepBucket)
    : CLEANUP_BUCKETS[0];
}

async function sweepDependencies(): Promise<SweepDependencies> {
  const client = getServiceClient();

  return {
    async loadCursor(): Promise<SweepCursor> {
      const { data, error } = await client
        .from('admin_asset_cleanup_sweep_state')
        .select('bucket, last_folder')
        .eq('id', 1)
        .single();
      if (error) throw error;

      return {
        bucket: cursorBucket(data.bucket),
        lastFolder: data.last_folder,
      };
    },

    async saveCursor(next): Promise<void> {
      const { error } = await client
        .from('admin_asset_cleanup_sweep_state')
        .update({
          bucket: next.bucket,
          last_folder: next.lastFolder,
          last_run_at: new Date().toISOString(),
        })
        .eq('id', 1);
      if (error) throw error;
    },

    async list(bucket, prefix, offset) {
      const { data, error } = await client.storage.from(bucket).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;

      const entries = data ?? [];
      return {
        entries: entries.map(entry => ({
          name: entry.name,
          isFolder: entry.id === null,
          createdAt: entry.created_at ?? null,
        })),
        hasMore: entries.length === 100,
      };
    },

    async isReferenced(bucket, path) {
      const { data, error } = await client.rpc('cleanup_asset_is_referenced', {
        p_bucket: bucket,
        p_path: path,
      });
      if (error) throw error;

      return data === true;
    },

    async enqueueOrphan(target) {
      const { data, error } = await client.rpc('cleanup_enqueue_orphan', {
        p_bucket: target.bucket,
        p_path: target.path,
        p_target_type: target.targetType,
      });
      if (error) throw error;

      return data ?? null;
    },

    now: Date.now,
  };
}

export async function defaultCleanupHandlerDependencies(): Promise<CleanupHandlerDependencies> {
  const env = getServerEnv();

  return {
    secrets: () => ({
      workerSecret: env.cleanupWorkerSecret,
      cronSecret: env.cronSecret,
    }),
    run: runWorker,
    sweep: async () => runCleanupSweep(await sweepDependencies()),
  };
}
