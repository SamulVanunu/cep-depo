import {
  BATCH_LIMIT,
  JOB_BUDGET_MS,
  LEASE_SECONDS,
  RUN_BUDGET_MS,
  USABLE_BUDGET_MS,
} from './cleanup-config';
import { managedTarget } from './cleanup-paths';

// No `server-only` import: the HTTP routes own that boundary and the batch
// runner stays unit-testable.

export type CleanupJob = Readonly<{
  jobId: string;
  bucket: string;
  path: string;
  targetType: string;
  attempts: number;
  leaseToken: string;
  /** Storage version pinned when the tombstone was enqueued; null for legacy rows. */
  storageVersion: string | null;
}>;

/** Structural copy of the admin Storage probe result. */
export type CleanupObjectProbe = Readonly<{
  state: 'present' | 'missing' | 'unknown';
  lastModified: string | null;
  version: string | null;
}>;

export type CleanupCounters = Readonly<{
  claimed: number;
  completed: number;
  skippedReferenced: number;
  skippedOwnership: number;
  quarantined: number;
  failed: number;
  leaseLost: number;
  released: number;
}>;

export type SkipReason = 'referenced' | 'ownership_mismatch' | 'race_detected';

// The SQL decides whether a skip actually retires the path (`skipped`) or
// closes it permanently (`quarantined`). The worker mirrors that answer; it
// never derives the outcome from the reason alone.
export type SkipResult = 'skipped' | 'quarantined';

export type FailResult = Readonly<{ quarantined: boolean }>;

export type CleanupWorkerDependencies = Readonly<{
  claimJobs(input: Readonly<{
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }>): Promise<readonly CleanupJob[]>;
  startJob(jobId: string, workerId: string, leaseToken: string): Promise<number>;
  isReferenced(bucket: string, path: string): Promise<boolean>;
  /** Reads the live catalog's apk/icon paths; throws when it cannot be read. */
  isCatalogReferenced(bucket: string, path: string): Promise<boolean>;
  /**
   * Independent check for a catalog release document: true means the pointer,
   * the retained window or an unreadable ledger still protects it.
   */
  isCatalogReleaseRetained(releaseId: string): Promise<boolean>;
  /** Probes Storage for a legacy job that has no enqueue-time fingerprint. */
  inspectObject(bucket: string, path: string): Promise<CleanupObjectProbe>;
  /**
   * Deletes exactly `versionId`. A stale version must report `removed: false`
   * without an error, so the worker completes instead of deleting a replacement.
   */
  removeObject(
    bucket: string,
    path: string,
    version: string,
  ): Promise<{ error: unknown | null; removed: boolean }>;
  completeJob(jobId: string, workerId: string): Promise<void>;
  failJob(jobId: string, workerId: string, error: string): Promise<FailResult>;
  skipJob(jobId: string, workerId: string, reason: SkipReason): Promise<SkipResult>;
  releaseJob(jobId: string, workerId: string, leaseToken: string): Promise<void>;
  now?(): number;
}>;

export function isLeaseLost(error: unknown): boolean {
  if (typeof error === 'string') return error.includes('CLN01');
  if (!error || typeof error !== 'object') return false;

  const record = error as { code?: unknown; message?: unknown };
  return (
    record.code === 'CLN01' ||
    (typeof record.message === 'string' && record.message.includes('CLN01'))
  );
}

export function isMissingObject(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof Error) {
    return /not found|not_found|NoSuchKey|404/i.test(error.message);
  }
  if (typeof error !== 'object') return false;

  const record = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const status = typeof record.statusCode === 'number' ? record.statusCode : record.status;
  if (status === 404 || status === '404') return true;
  if (record.code === 'not_found' || record.code === 'NoSuchKey' || record.code === '404') {
    return true;
  }
  return (
    typeof record.message === 'string' &&
    /not found|NoSuchKey|404/i.test(record.message)
  );
}

export function describeJobError(error: unknown): string {
  let raw: string | null = null;
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === 'string') {
    raw = error;
  } else if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') raw = message;
  }

  const text = (raw ?? '').trim() || 'Bilinmeyen hata';
  const redacted = text.replace(
    /(https?:\/\/[^?\s#]*)\?[^#\s]*/g,
    '$1?[redacted]',
  );

  return redacted.slice(0, 500);
}

/**
 * Runs one bounded batch of cleanup jobs.
 *
 * Every job re-validates its own row (bucket, target type, canonical path)
 * before touching Storage: the queue is data, not a trusted instruction. The
 * reference check runs twice around the removal so a reference that appears
 * while the object is being deleted is detected and the job is quarantined as
 * a race instead of reported as completed.
 */
export async function runCleanupBatch(
  dependencies: CleanupWorkerDependencies,
  workerId: string,
): Promise<CleanupCounters> {
  const clock = dependencies.now ?? Date.now;
  const runStart = clock();
  const runDeadline = runStart + RUN_BUDGET_MS;
  const usableDeadline = runStart + USABLE_BUDGET_MS;

  const counters = {
    claimed: 0,
    completed: 0,
    skippedReferenced: 0,
    skippedOwnership: 0,
    quarantined: 0,
    failed: 0,
    leaseLost: 0,
    released: 0,
  };

  // The RPC, not the worker, decides whether a skip retires the path or
  // quarantines it. Counters follow the returned value so a gate hit inside
  // `cleanup_skip_job` is reported as a quarantine, never as a skip.
  async function recordSkip(jobId: string, reason: SkipReason): Promise<void> {
    const result = await dependencies.skipJob(jobId, workerId, reason);
    if (result === 'quarantined') {
      counters.quarantined += 1;
      return;
    }
    if (result !== 'skipped') {
      throw new Error(`Beklenmeyen atlama sonucu: ${String(result)}`);
    }
    if (reason === 'ownership_mismatch') {
      counters.skippedOwnership += 1;
      return;
    }
    if (reason === 'referenced') {
      counters.skippedReferenced += 1;
      return;
    }
    // race_detected is always a quarantine in the SQL contract. A 'skipped'
    // here means the contract drifted; surface it as a job error.
    throw new Error('race_detected karantina olmadan atlanamaz.');
  }

  // A quarantined job is not an ordinary failure: the SQL reports the terminal
  // state through `quarantined`, so it gets its own counter.
  async function recordFailure(jobId: string, error: unknown): Promise<void> {
    if (isLeaseLost(error)) {
      counters.leaseLost += 1;
      return;
    }

    try {
      const result = await dependencies.failJob(
        jobId,
        workerId,
        describeJobError(error),
      );
      if (result.quarantined) {
        counters.quarantined += 1;
      } else {
        counters.failed += 1;
      }
    } catch (failure) {
      // If recording the failure also loses the lease, the job is already
      // someone else's problem; the next claim will retry it.
      if (isLeaseLost(failure)) {
        counters.leaseLost += 1;
        return;
      }
      // The failure could not be recorded. It is still not a success.
      counters.failed += 1;
    }
  }

  // A claim that never started may be handed back without charging an attempt.
  // A token mismatch or an expired lease is CLN01; a claim that did start is
  // CLN09 and belongs to its own fail/complete/skip path.
  async function releaseUnstarted(job: CleanupJob): Promise<void> {
    try {
      await dependencies.releaseJob(job.jobId, workerId, job.leaseToken);
      counters.released += 1;
    } catch (error) {
      if (isLeaseLost(error)) {
        counters.leaseLost += 1;
      }
    }
  }

  for (;;) {
    // `p_limit` is a ceiling, not a promise. Only claim as many jobs as the
    // usable part of the run can finish; the tail is reserved for the terminal
    // write of a job that has already started.
    const usableRemaining = usableDeadline - clock();
    const waveLimit = Math.min(
      BATCH_LIMIT - counters.claimed,
      Math.floor(usableRemaining / JOB_BUDGET_MS),
    );
    if (waveLimit < 1) break;

    const jobs = await dependencies.claimJobs({
      workerId,
      limit: waveLimit,
      leaseSeconds: LEASE_SECONDS,
    });
    counters.claimed += jobs.length;

    if (jobs.length === 0) break;

    let reached = 0;
    for (const job of jobs) {
      if (clock() >= usableDeadline) break;
      reached += 1;

      const jobDeadline = Math.min(clock() + JOB_BUDGET_MS, usableDeadline);
      let started = false;

      try {
        // This is the only attempt-consuming transition. It runs before any
        // Storage call, so releaseUnstarted() can never hide an in-flight
        // remove.
        await dependencies.startJob(job.jobId, workerId, job.leaseToken);
        started = true;

        const target = managedTarget(job.bucket, job.path, job.targetType);
        if (!target) {
          // A catalog row that cannot be validated must not free its path: a
          // skip would retire the tombstone and allow a later object to take
          // the same name. Asset rows keep the historical ownership skip.
          if (job.bucket === 'catalog') {
            throw new Error('Katalog temizlik hedefi doğrulanamadı.');
          }
          await recordSkip(job.jobId, 'ownership_mismatch');
          continue;
        }

        if (await dependencies.isReferenced(target.bucket, target.path)) {
          await recordSkip(job.jobId, 'referenced');
          continue;
        }

        if (target.bucket === 'catalog') {
          // `catalog_document` is the only catalog target type, so the parsed
          // release id must be present; a missing one is a contract drift.
          const releaseId = target.releaseId;
          if (releaseId === null) {
            throw new Error('Katalog hedefinde release kimliği yok.');
          }

          // Independent second read of the same predicate. A `true` here means
          // the release is current, retained or unprovable; never delete.
          if (await dependencies.isCatalogReleaseRetained(releaseId)) {
            await recordSkip(job.jobId, 'referenced');
            continue;
          }
        } else if (target.bucket !== 'apk-drafts') {
          // The catalog bucket never reaches this branch: `isCatalogReferenced`
          // looks up apks/app-assets keys and would wrongly answer false for a
          // release document.
          //
          // F-08: the published catalog is the public source of truth and can
          // still name a path after its database row is gone (stale release or a
          // failed refresh). Any read, timeout or parse failure escapes this call
          // and becomes a normal failJob retry; Storage is never touched.
          if (await dependencies.isCatalogReferenced(target.bucket, target.path)) {
            throw new Error('Dosya canlı katalogda hâlâ referanslı.');
          }
        }

        if (clock() >= jobDeadline) {
          throw new Error('İş bütçesi aşıldı.');
        }

        let removal: { error: unknown | null; removed: boolean };
        if (job.storageVersion) {
          // Conditional delete: only the version captured at enqueue can go.
          removal = await dependencies.removeObject(
            target.bucket,
            target.path,
            job.storageVersion,
          );
        } else {
          // Legacy row without a fingerprint. A missing object is already the
          // desired end state; a present one cannot be proven to be the object
          // the tombstone was created for, so no automatic delete is allowed.
          const probe = await dependencies.inspectObject(target.bucket, target.path);
          if (probe.state === 'missing') {
            await dependencies.completeJob(job.jobId, workerId);
            counters.completed += 1;
            continue;
          }
          if (probe.state === 'unknown') {
            throw new Error('Depolama nesnesi doğrulanamadı; silme yapılmadı.');
          }
          throw new Error(
            'Nesne kuyruğa alındıktan sonra oluşturulmuş olabilir; silme kimliği doğrulanamadı.',
          );
        }
        if (removal.error && !isMissingObject(removal.error)) {
          throw removal.error;
        }

        // Re-check after the delete. If a reference came back, the object may
        // have been recreated mid-delete: quarantine the path and never write
        // `completed`.
        if (await dependencies.isReferenced(target.bucket, target.path)) {
          await recordSkip(job.jobId, 'race_detected');
          continue;
        }

        await dependencies.completeJob(job.jobId, workerId);
        counters.completed += 1;
      } catch (error) {
        if (isLeaseLost(error)) {
          counters.leaseLost += 1;
          continue;
        }
        if (!started) {
          // Start did not commit a processing marker. Hand the claim back
          // instead of spending an attempt on a job we never touched.
          await releaseUnstarted(job);
          continue;
        }
        await recordFailure(job.jobId, error);
      }
    }

    // This is normally empty: the wave gate above only claims work that fits.
    // It still protects any claim left over from an older wave, a changed
    // budget or a clock jump.
    for (const job of jobs.slice(reached)) {
      if (clock() >= runDeadline) break;
      await releaseUnstarted(job);
    }

    if (counters.claimed >= BATCH_LIMIT) break;
  }

  return counters;
}
