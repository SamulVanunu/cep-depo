'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { requireAdmin } from '../../server/auth/require-admin';
import { getServerEnv } from '../../lib/env';
import type { Json } from '../../types/database.types';
import { APK_MIME_TYPES } from '../uploads/upload-schema';
import {
  removeOrEnqueueAssets,
  type CleanupAsset,
} from '../uploads/asset-cleanup';
import { parseExternalApkUrl } from '../uploads/external-apk';

type Actor = Readonly<{ userId: string }>;
type Draft =
  | Readonly<{
      source: 'storage';
      id: string;
      appId: string;
      draftPath: string;
      canonicalPath: string;
      size: number;
    }>
  | Readonly<{
      source: 'external';
      id: string;
      appId: string;
      apkUrl: string;
    }>;

export type PublishDependencies = Readonly<{
  authorize(): Promise<Actor>;
  getDraft(versionId: string): Promise<Draft | null>;
  inspectCanonical(path: string): Promise<Readonly<{ size: number }> | null>;
  copyToCanonical(draftPath: string, canonicalPath: string): Promise<void>;
  publishRpc(actorId: string, versionId: string): Promise<{ error: unknown | null }>;
  externalPublishingEnabled: boolean;
  revalidate?(appId: string): void;
}>;

export type ReplaceVersionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  getDraft(versionId: string): Promise<Draft | null>;
  inspectCanonical(path: string): Promise<Readonly<{ size: number; mimeType: string }> | null>;
  copyToCanonical(draftPath: string, canonicalPath: string): Promise<void>;
  publishRpc(
    actorId: string,
    versionId: string,
  ): Promise<{ data: readonly string[] | null; error: unknown | null }>;
  cleanupAssets(assets: readonly CleanupAsset[]): Promise<{ pending: number }>;
  externalPublishingEnabled: boolean;
  revalidate?(appId: string): void;
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
    if (draft.source === 'external' && !dependencies.externalPublishingEnabled) {
      throw new ActionException('FEATURE_DISABLED');
    }
    if (draft.source === 'external') {
      try {
        parseExternalApkUrl(draft.apkUrl);
      } catch {
        throw new ActionException('VALIDATION');
      }
    }
    if (draft.source === 'storage') {
      const existing = await dependencies.inspectCanonical(draft.canonicalPath);
      if (existing && existing.size !== draft.size) throw new ActionException('CONFLICT');
      if (!existing) await dependencies.copyToCanonical(draft.draftPath, draft.canonicalPath);
      const verified = await dependencies.inspectCanonical(draft.canonicalPath);
      if (!verified || verified.size !== draft.size) throw new ActionException('TEMPORARY');
    }
    const published = await dependencies.publishRpc(actor.userId, id);
    if (published.error) throw new ActionException('TEMPORARY');
    dependencies.revalidate?.(draft.appId);
    return { ok: true, data: { status: 'published' } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

function cleanupAssetsFromRpc(paths: readonly string[], appId: string): CleanupAsset[] {
  const escapedAppId = appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathPattern = new RegExp(
    `^apps/${escapedAppId}/versions/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.apk$`,
  );
  return paths.map(path => {
    const match = pathPattern.exec(path);
    if (!match) throw new ActionException('INTERNAL');
    return {
      bucket: 'apks',
      path,
      operationId: match[1],
      targetType: 'apk',
    };
  });
}

export async function publishVersionReplacingPrevious(
  versionId: string,
  dependencies: ReplaceVersionDependencies,
): Promise<ActionResult<Readonly<{ status: 'published'; cleanupPending: boolean }>>> {
  try {
    const id = z.string().uuid().parse(versionId);
    const actor = await dependencies.authorize();
    const draft = await dependencies.getDraft(id);
    if (!draft) throw new ActionException('NOT_FOUND');
    if (draft.source === 'external' && !dependencies.externalPublishingEnabled) {
      throw new ActionException('FEATURE_DISABLED');
    }
    if (draft.source === 'external') {
      try {
        parseExternalApkUrl(draft.apkUrl);
      } catch {
        throw new ActionException('VALIDATION');
      }
    }
    if (draft.source === 'storage') {
      const existing = await dependencies.inspectCanonical(draft.canonicalPath);
      if (
        existing && (
          existing.size !== draft.size ||
          !APK_MIME_TYPES.includes(existing.mimeType as (typeof APK_MIME_TYPES)[number])
        )
      ) {
        throw new ActionException('CONFLICT');
      }
      if (!existing) await dependencies.copyToCanonical(draft.draftPath, draft.canonicalPath);
      const verified = await dependencies.inspectCanonical(draft.canonicalPath);
      if (
        !verified ||
        verified.size !== draft.size ||
        !APK_MIME_TYPES.includes(verified.mimeType as (typeof APK_MIME_TYPES)[number])
      ) {
        throw new ActionException('TEMPORARY');
      }
    }

    const published = await dependencies.publishRpc(actor.userId, id);
    if (published.error || !published.data) throw new ActionException('TEMPORARY');

    let cleanupPending = false;
    try {
      const assets = cleanupAssetsFromRpc(published.data, draft.appId);
      const cleanup = await dependencies.cleanupAssets(assets);
      cleanupPending = cleanup.pending > 0;
    } catch {
      cleanupPending = true;
    }
    dependencies.revalidate?.(draft.appId);
    return {
      ok: true,
      data: { status: 'published', cleanupPending },
    };
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
    externalPublishingEnabled: getServerEnv().externalApkPublishingEnabled,
    async getDraft(versionId) {
      const db = await database();
      const version = await db
        .from('app_versions')
        .select('id, app_id, download_source, apk_path, apk_url, apk_size_bytes, status')
        .eq('id', versionId)
        .eq('status', 'draft')
        .maybeSingle();
      if (version.error) throw version.error;
      if (!version.data) return null;
      if (version.data.download_source === 'external' && version.data.apk_url) {
        return {
          source: 'external',
          id: version.data.id,
          appId: version.data.app_id,
          apkUrl: version.data.apk_url,
        };
      }
      const audit = await db
        .from('admin_audit_logs')
        .select('metadata')
        .eq('target_id', versionId)
        .eq('action', 'version.draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (audit.error) throw audit.error;
      const metadata = audit.data?.metadata;
      const draftPath = metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.path === 'string' ? metadata.path : null;
      return draftPath && version.data.apk_path ? {
        source: 'storage',
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
      return db.rpc('admin_publish_version_and_activate_app', {
        p_actor_id: actorId,
        p_version_id: versionId,
      });
    },
    revalidate(appId) {
      revalidatePath('/');
      revalidatePath('/publish');
      revalidatePath('/apps');
      revalidatePath(`/apps/${appId}`);
    },
  };
}

function defaultReplaceVersionDependencies(): ReplaceVersionDependencies {
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
    externalPublishingEnabled: getServerEnv().externalApkPublishingEnabled,
    async getDraft(versionId) {
      const db = await database();
      const version = await db
        .from('app_versions')
        .select('id, app_id, download_source, apk_path, apk_url, apk_size_bytes, status')
        .eq('id', versionId)
        .eq('status', 'draft')
        .maybeSingle();
      if (version.error) throw version.error;
      if (!version.data) return null;
      if (version.data.download_source === 'external' && version.data.apk_url) {
        return {
          source: 'external',
          id: version.data.id,
          appId: version.data.app_id,
          apkUrl: version.data.apk_url,
        };
      }
      const audit = await db
        .from('admin_audit_logs')
        .select('metadata')
        .eq('target_id', versionId)
        .eq('action', 'version.draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (audit.error) throw audit.error;
      const metadata = audit.data?.metadata;
      const draftPath = metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.path === 'string'
        ? metadata.path
        : null;
      return draftPath && version.data.apk_path ? {
        source: 'storage',
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
      return result.error || !result.data ||
        typeof result.data.size !== 'number' || typeof result.data.contentType !== 'string'
        ? null
        : { size: result.data.size, mimeType: result.data.contentType };
    },
    async copyToCanonical(draftPath, canonicalPath) {
      const db = await database();
      const result = await db.storage.from('apk-drafts').copy(draftPath, canonicalPath, {
        destinationBucket: 'apks',
      });
      if (result.error) throw result.error;
    },
    async publishRpc(actorId, versionId) {
      const db = await database();
      return db.rpc('admin_publish_version_replacing_previous', {
        p_actor_id: actorId,
        p_version_id: versionId,
      });
    },
    async cleanupAssets(assets) {
      const db = await database();
      return removeOrEnqueueAssets(assets, {
        async remove(bucket, path) {
          return db.storage.from(bucket).remove([path]);
        },
        async enqueue(asset) {
          const queued = await db.from('admin_asset_cleanup_jobs').insert({
            bucket: asset.bucket,
            path: asset.path,
            operation_id: asset.operationId,
            target_type: asset.targetType,
            last_error_at: new Date().toISOString(),
          });
          if (queued.error) return { error: queued.error };
          const audit = await db.rpc('admin_record_external_action', {
            p_actor_id: (await authorize()).userId,
            p_action: 'asset.cleanup_pending',
            p_target_type: 'asset',
            p_target_id: asset.operationId,
            p_metadata: {
              bucket: asset.bucket,
              path: asset.path,
              operation_id: asset.operationId,
            } as Json,
          });
          return { error: audit.error };
        },
        async complete(asset) {
          return db
            .from('admin_asset_cleanup_jobs')
            .update({ completed_at: new Date().toISOString() })
            .eq('bucket', asset.bucket)
            .eq('path', asset.path)
            .is('completed_at', null);
        },
      });
    },
    revalidate(appId) {
      revalidatePath('/');
      revalidatePath('/publish');
      revalidatePath('/apps');
      revalidatePath(`/apps/${appId}`);
    },
  };
}

export async function publishVersionAction(versionId: string) {
  return publishVersion(versionId, defaultPublishDependencies());
}

export async function publishVersionReplacingPreviousAction(versionId: string) {
  return publishVersionReplacingPrevious(versionId, defaultReplaceVersionDependencies());
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
