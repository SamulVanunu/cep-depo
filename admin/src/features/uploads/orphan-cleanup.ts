'use server';

import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { requireAdmin } from '../../server/auth/require-admin';
import { managedTarget } from './cleanup-paths';
import { enqueueCleanupAndAudit } from './cleanup-enqueue';

export type OrphanCleanupData = Readonly<{
  /** True when a pending cleanup job for this draft already existed. */
  deduped: boolean;
  /** True when the object is queued but its actor-facing audit row is missing. */
  auditPending: boolean;
}>;

/**
 * Queues an unreferenced upload draft for the cleanup worker. The Storage
 * object is not deleted here: the tombstone created by the enqueue blocks new
 * references, and the worker deletes the object later.
 */
export async function cleanupOrphanUploadAction(
  path: string,
): Promise<ActionResult<OrphanCleanupData>> {
  try {
    const target = managedTarget('apk-drafts', path, 'apk_draft');
    if (!target) throw new ActionException('VALIDATION');
    const identity = await requireAdmin(undefined, { mutation: true });
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    const client = getAdminClient(identity);
    const references = await client
      .from('admin_audit_logs')
      .select('id')
      .eq('action', 'version.draft')
      .contains('metadata', { path })
      .limit(1);
    if (references.error) throw references.error;
    if (references.data.length) throw new ActionException('CONFLICT');
    const queued = await enqueueCleanupAndAudit(client, {
      actorId: identity.userId,
      asset: {
        bucket: 'apk-drafts',
        path: target.path,
        assetId: target.assetId,
        targetType: 'apk_draft',
      },
      auditAction: 'upload.cleanup',
    });
    // The tombstone is the deletion fact. An audit failure only leaves the
    // actor-facing row missing; it must not report a queued cleanup as failed.
    if (!queued.queued) throw queued.enqueueError ?? new ActionException('TEMPORARY');
    return {
      ok: true,
      data: { deduped: queued.deduped, auditPending: queued.audit === 'failed' },
    };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
