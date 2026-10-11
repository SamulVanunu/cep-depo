import 'server-only';

import { requireAdmin } from '../../server/auth/require-admin';
import { ActionException } from '../../server/errors/action-error';
import { getAdminClient } from '../../server/supabase/admin-client';
import { operationPath } from './upload-schema';

export async function listOrphanUploads() {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  const folders = await client.storage.from('apk-drafts').list('operations', { limit: 100 });
  if (folders.error) throw new ActionException('TEMPORARY');

  const paths = (await Promise.all((folders.data ?? []).map(async folder => {
    const files = await client.storage.from('apk-drafts').list(`operations/${folder.name}`, { limit: 10 });
    if (files.error) return [];
    return (files.data ?? []).map(file => `operations/${folder.name}/${file.name}`).filter(path => operationPath.test(path));
  }))).flat();
  if (!paths.length) return [];

  const audit = await client
    .from('admin_audit_logs')
    .select('metadata')
    .eq('action', 'version.draft');
  if (audit.error) throw new ActionException('TEMPORARY');
  const referenced = new Set((audit.data ?? []).flatMap(row => {
    const metadata = row.metadata;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.path === 'string'
      ? [metadata.path]
      : [];
  }));
  return paths.filter(path => !referenced.has(path));
}
