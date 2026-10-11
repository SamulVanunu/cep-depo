'use server';

import { z } from 'zod';

import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { requireAdmin } from '../../server/auth/require-admin';

type Actor = Readonly<{ userId: string }>;
type Draft = Readonly<{
  id: string;
  appId: string;
  draftPath: string;
  canonicalPath: string;
  size: number;
}>;

export type PublishDependencies = Readonly<{
  authorize(): Promise<Actor>;
  getDraft(versionId: string): Promise<Draft | null>;
  inspectCanonical(path: string): Promise<Readonly<{ size: number }> | null>;
  copyToCanonical(draftPath: string, canonicalPath: string): Promise<void>;
  publishRpc(actorId: string, versionId: string): Promise<{ error: unknown | null }>;
}>;

export async function publishVersion(
  versionId: string,
  dependencies: PublishDependencies,
): Promise<ActionResult<Readonly<{ status: 'published' }>>> {
  try {
    const id = z.string().uuid().parse(versionId);
    const actor = await dependencies.authorize();
    const draft = await dependencies.getDraft(id);
    if (!draft) throw new ActionException('NOT_FOUND');
    const existing = await dependencies.inspectCanonical(draft.canonicalPath);
    if (existing && existing.size !== draft.size) throw new ActionException('CONFLICT');
    if (!existing) await dependencies.copyToCanonical(draft.draftPath, draft.canonicalPath);
    const verified = await dependencies.inspectCanonical(draft.canonicalPath);
    if (!verified || verified.size !== draft.size) throw new ActionException('TEMPORARY');
    const published = await dependencies.publishRpc(actor.userId, id);
    if (published.error) throw new ActionException('TEMPORARY');
    return { ok: true, data: { status: 'published' } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

function defaultPublishDependencies(): PublishDependencies {
  let identity: Awaited<ReturnType<typeof requireAdmin>> | null = null;
  let client: ReturnType<typeof import('../../server/supabase/admin-client')['getAdminClient']> | null = null;
  async function authorize() {
    identity ??= await requireAdmin(undefined, { mutation: true });
    return identity;
  }
  async function database() {
    const actor = await authorize();
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    client ??= getAdminClient(actor);
    return client;
  }
  return {
    authorize,
    async getDraft(versionId) {
      const db = await database();
      const [version, audit] = await Promise.all([
        db.from('app_versions').select('id, app_id, apk_path, apk_size_bytes, status').eq('id', versionId).eq('status', 'draft').maybeSingle(),
        db.from('admin_audit_logs').select('metadata').eq('target_id', versionId).eq('action', 'version.draft').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (version.error || audit.error) throw version.error ?? audit.error;
      const metadata = audit.data?.metadata;
      const draftPath = metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.path === 'string' ? metadata.path : null;
      return version.data && draftPath ? {
        id: version.data.id,
        appId: version.data.app_id,
        draftPath,
        canonicalPath: version.data.apk_path,
        size: version.data.apk_size_bytes,
      } : null;
    },
    async inspectCanonical(path) {
      const db = await database();
      const result = await db.storage.from('apks').info(path);
      return result.error || !result.data || typeof result.data.size !== 'number'
        ? null
        : { size: result.data.size };
    },
    async copyToCanonical(draftPath, canonicalPath) {
      const db = await database();
      const result = await db.storage.from('apk-drafts').copy(draftPath, canonicalPath, { destinationBucket: 'apks' });
      if (result.error) throw result.error;
    },
    async publishRpc(actorId, versionId) {
      const db = await database();
      return db.rpc('admin_publish_version', { p_actor_id: actorId, p_version_id: versionId });
    },
  };
}

export async function publishVersionAction(versionId: string) {
  return publishVersion(versionId, defaultPublishDependencies());
}

export async function withdrawVersionAction(versionId: string): Promise<ActionResult<Readonly<{ status: 'withdrawn' }>>> {
  try {
    const id = z.string().uuid().parse(versionId);
    const identity = await requireAdmin(undefined, { mutation: true });
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    const result = await getAdminClient(identity).rpc('admin_withdraw_version', {
      p_actor_id: identity.userId,
      p_version_id: id,
    });
    if (result.error) throw result.error;
    return { ok: true, data: { status: 'withdrawn' } };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}
