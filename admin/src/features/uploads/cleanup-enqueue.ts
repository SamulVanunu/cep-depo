import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';
import type { CleanupAsset } from './asset-cleanup';

/**
 * The audit action decides which actor-facing log row is written. Both actions
 * are recorded when the tombstone is created, never when the object is deleted:
 * the worker owns deletion and logs it in admin_asset_cleanup_events instead.
 */
export type CleanupAuditAction = 'asset.cleanup_pending' | 'upload.cleanup';

export type CleanupAuditState =
  | 'recorded'
  | 'already_recorded'
  | 'not_attempted'
  | 'failed';

type CleanupError = Readonly<{ code?: string }> | null;

/**
 * Enqueue and audit are two separate operations with independent outcomes.
 *
 * `queued` is the tombstone fact: once cleanup_enqueue_orphan returns a job id
 * or a dedupe null, the object is queued and the worker will delete it. The
 * audit row is actor-facing history, so its failure must never turn the queued
 * tombstone into a reported enqueue failure.
 */
export type CleanupEnqueueResult = Readonly<{
  /** True when a tombstone exists for the object (new or already pending). */
  queued: boolean;
  /** True when the pending tombstone already existed. */
  deduped: boolean;
  audit: CleanupAuditState;
  /** Set only when the tombstone could not be created. */
  enqueueError: CleanupError;
  /** Set only when the audit row could not be read or written. */
  auditError: CleanupError;
}>;

export type CleanupEnqueueInput = Readonly<{
  actorId: string;
  asset: CleanupAsset;
  auditAction: CleanupAuditAction;
}>;

/**
 * The audit is keyed by (action, metadata.path): one actor-facing row per
 * managed object, not per enqueue attempt. A deduplicated enqueue therefore
 * asks the database to return the existing row or write the missing one.
 *
 * The SQL function takes a transaction-scoped advisory lock per (action, path)
 * and re-reads the pair after the lock, so two concurrent callers for the same
 * object serialize and only one row is ever created. A READ COMMITTED caller is
 * required; the function refuses anything stricter instead of risking a stale
 * snapshot duplicate.
 *
 * Only a well-formed `{ id, created }` row is accepted. Anything else (an
 * empty result, a malformed row, a database error) is an audit failure, never
 * a silent success, and never falls back to the old non-idempotent RPC.
 */

type CleanupAuditRow = Readonly<{ id: string; created: boolean }>;

function isCleanupAuditRow(value: unknown): value is CleanupAuditRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.created === 'boolean';
}

async function ensureCleanupAudit(
  client: SupabaseClient<Database>,
  input: CleanupEnqueueInput,
): Promise<Readonly<{ state: CleanupAuditState; error: CleanupError }>> {
  const audit = await client.rpc('admin_ensure_cleanup_audit', {
    p_actor_id: input.actorId,
    p_action: input.auditAction,
    p_target_type: input.auditAction === 'upload.cleanup' ? 'upload' : 'asset',
    p_target_id: input.auditAction === 'upload.cleanup' ? input.asset.path : input.asset.assetId,
    p_metadata: {
      bucket: input.asset.bucket,
      path: input.asset.path,
      // The audit SQL contract calls this field operation_id and requires it
      // to equal target_id for asset.cleanup_pending. Its meaning here is the
      // path-derived asset id, never a browser request id or a queue job id.
      operation_id: input.asset.assetId,
    },
  });

  if (audit.error) {
    // The tombstone already exists; the row is only history. Never downgrade a
    // queued cleanup because its audit could not be read or written.
    return { state: 'failed', error: audit.error };
  }

  const row = Array.isArray(audit.data) ? audit.data[0] : null;
  if (!isCleanupAuditRow(row)) {
    return { state: 'failed', error: { code: 'AUDIT_CONTRACT' } };
  }

  return row.created
    ? { state: 'recorded', error: null }
    : { state: 'already_recorded', error: null };
}

/**
 * Creates the cleanup tombstone through the SQL contract and records the audit
 * row for it. The tombstone is the source of truth for deletion: a queue
 * success stays `queued: true` even when the audit write fails, and a dedupe
 * retries a previously missing audit row instead of skipping it forever.
 *
 * This never touches Storage: the worker performs seal -> remove -> recheck ->
 * complete later, off the request path.
 */
export async function enqueueCleanupAndAudit(
  client: SupabaseClient<Database>,
  input: CleanupEnqueueInput,
): Promise<CleanupEnqueueResult> {
  const { asset } = input;
  const queued = await client.rpc('cleanup_enqueue_orphan', {
    p_bucket: asset.bucket,
    p_path: asset.path,
    p_target_type: asset.targetType,
  });

  if (queued.error) {
    return {
      queued: false,
      deduped: false,
      audit: 'not_attempted',
      enqueueError: queued.error,
      auditError: null,
    };
  }

  const audit = await ensureCleanupAudit(client, input);

  return {
    queued: true,
    deduped: queued.data === null,
    audit: audit.state,
    enqueueError: null,
    auditError: audit.error,
  };
}
