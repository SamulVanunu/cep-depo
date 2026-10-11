'use server';

import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { requireAdmin } from '../../server/auth/require-admin';
import { operationPath } from './upload-schema';

export async function cleanupOrphanUploadAction(path: string): Promise<ActionResult<null>> {
  try {
    if (!operationPath.test(path)) throw new ActionException('VALIDATION');
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
    const removal = await client.storage.from('apk-drafts').remove([path]);
    if (removal.error) throw removal.error;
    const audit = await client.rpc('admin_record_external_action', {
      p_actor_id: identity.userId,
      p_action: 'upload.cleanup',
      p_target_type: 'upload',
      p_target_id: path,
      p_metadata: { bucket: 'apk-drafts', path },
    });
    if (audit.error) throw audit.error;
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
