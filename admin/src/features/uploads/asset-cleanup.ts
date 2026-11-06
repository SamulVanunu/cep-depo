'use server';

import { z } from 'zod';

import { ActionException } from '../../server/errors/action-error';
import type { CleanupEnqueueResult } from './cleanup-enqueue';
import { CLEANUP_PATH_PATTERNS, managedTarget } from './cleanup-paths';

export type { CleanupEnqueueResult } from './cleanup-enqueue';

/**
 * `assetId` is the identity of the stored object, derived from its canonical
 * path. It is not a request id and not a queue job id: callers must derive it
 * through `managedTarget` instead of inventing one.
 */
export type CleanupAsset = Readonly<{
  bucket: 'apk-drafts' | 'apks' | 'app-assets';
  path: string;
  assetId: string;
  targetType: 'apk_draft' | 'apk' | 'icon' | 'screenshot';
}>;

/**
 * The caller owns the SQL contract (cleanup_enqueue_orphan) and the audit row.
 * This module never deletes anything: a queued job is a tombstone, and the
 * cleanup worker performs the Storage deletion after the request returns.
 */
export type CleanupDependencies = Readonly<{
  enqueue(asset: CleanupAsset): Promise<CleanupEnqueueResult>;
}>;

export type CleanupOutcome = Readonly<{
  /** Objects with a tombstone, including ones that were already queued. */
  queued: number;
  /** Subset of queued that a previous call had already queued. */
  alreadyQueued: number;
  /** Objects whose tombstone could not be created; they still need attention. */
  enqueueFailures: number;
  /** Queued objects whose actor-facing audit row could not be recorded. */
  auditFailures: number;
}>;

// One source of truth for the managed path shapes: the same patterns validate
// queue rows in the worker and drafts in the sweeper.
const cleanupAssetSchema = z.discriminatedUnion('targetType', [
  z.object({
    bucket: z.literal('apk-drafts'),
    path: z.string().regex(new RegExp(CLEANUP_PATH_PATTERNS.apk_draft)),
    assetId: z.string().uuid(),
    targetType: z.literal('apk_draft'),
  }),
  z.object({
    bucket: z.literal('apks'),
    path: z.string().regex(new RegExp(CLEANUP_PATH_PATTERNS.apk)),
    assetId: z.string().uuid(),
    targetType: z.literal('apk'),
  }),
  z.object({
    bucket: z.literal('app-assets'),
    path: z.string().regex(new RegExp(CLEANUP_PATH_PATTERNS.icon)),
    assetId: z.string().uuid(),
    targetType: z.literal('icon'),
  }),
  z.object({
    bucket: z.literal('app-assets'),
    path: z.string().regex(new RegExp(CLEANUP_PATH_PATTERNS.screenshot)),
    assetId: z.string().uuid(),
    targetType: z.literal('screenshot'),
  }),
]);

/**
 * Validates the whole batch, then enqueues one cleanup job per object. There is
 * no Storage fallback: when the queue rejects an object the caller must report
 * that cleanup is still pending instead of claiming a successful deletion.
 *
 * Enqueue success and audit success are independent: a queued tombstone counts
 * as queued even when its audit row could not be written, and that audit
 * failure is reported separately instead of inflating the enqueue failures.
 */
export async function enqueueCleanupAssets(
  assets: readonly CleanupAsset[],
  dependencies: CleanupDependencies,
): Promise<CleanupOutcome> {
  let validated: CleanupAsset[];
  try {
    validated = assets.map(asset => {
      const parsed = cleanupAssetSchema.parse(asset) as CleanupAsset;
      // Shape validation alone cannot catch a caller that pairs a real path
      // with an unrelated id (a request id, another file, a stale row). The
      // identity must be the one encoded in the canonical Storage path.
      const derived = managedTarget(parsed.bucket, parsed.path, parsed.targetType);
      if (!derived || derived.assetId !== parsed.assetId) {
        throw new ActionException('VALIDATION');
      }
      return parsed;
    });
  } catch {
    throw new ActionException('VALIDATION');
  }

  let queued = 0;
  let alreadyQueued = 0;
  let enqueueFailures = 0;
  let auditFailures = 0;

  for (const asset of validated) {
    let result: CleanupEnqueueResult;
    try {
      result = await dependencies.enqueue(asset);
    } catch {
      result = {
        queued: false,
        deduped: false,
        audit: 'not_attempted',
        enqueueError: { code: 'ENQUEUE_REJECTED' },
        auditError: null,
      };
    }

    if (!result.queued) {
      enqueueFailures += 1;
      continue;
    }

    queued += 1;
    if (result.deduped) alreadyQueued += 1;
    if (result.audit === 'failed') auditFailures += 1;
  }

  return { queued, alreadyQueued, enqueueFailures, auditFailures };
}
