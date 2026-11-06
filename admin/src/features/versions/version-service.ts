import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import type { ActionError, ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { requireAdmin } from '../../server/auth/require-admin';
import { getServerEnv } from '../../lib/env';
import { APK_MIME_TYPES } from '../uploads/upload-schema';
import {
  enqueueCleanupAssets,
  type CleanupAsset,
  type CleanupOutcome,
} from '../uploads/asset-cleanup';
import { enqueueCleanupAndAudit } from '../uploads/cleanup-enqueue';
import { assetIdFromDraftPath } from '../uploads/cleanup-paths';
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

/**
 * The catalog publication identity a publish request carries. The client mints
 * one id per publish action and reuses it on HTTP retries, so a lost response
 * is recoverable instead of starting a second operation.
 */
export type CatalogRefreshInput = Readonly<{ operationId: string }>;

export type ReplaceVersionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  getDraft(versionId: string): Promise<Draft | null>;
  inspectCanonical(path: string): Promise<Readonly<{ size: number; mimeType: string }> | null>;
  copyToCanonical(draftPath: string, canonicalPath: string): Promise<void>;
  publishRpc(
    actorId: string,
    versionId: string,
  ): Promise<{ data: readonly string[] | null; error: unknown | null }>;
  cleanupAssets(assets: readonly CleanupAsset[]): Promise<CleanupOutcome>;
  externalPublishingEnabled: boolean;
  revalidate?(appId: string): void;
  refreshCatalog?(input?: CatalogRefreshInput): Promise<{ error: ActionError | null }>;
}>;

export type WithdrawVersionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  withdrawRpc(actorId: string, versionId: string): Promise<{ error: unknown | null }>;
  refreshCatalog?(input?: CatalogRefreshInput): Promise<{ error: ActionError | null }>;
}>;

async function refreshCatalogWarning(
  refreshCatalog:
    | ((input?: CatalogRefreshInput) => Promise<{ error: ActionError | null }>)
    | undefined,
  operationId?: string,
): Promise<ActionError | undefined> {
  if (!refreshCatalog) return undefined;
  try {
    const result = await refreshCatalog(
      operationId === undefined ? undefined : { operationId },
    );
    return result.error ?? undefined;
  } catch {
    return toActionError(new ActionException('TEMPORARY'));
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
      assetId: match[1],
      targetType: 'apk',
    };
  });
}

export async function publishVersionReplacingPrevious(
  versionId: string,
  dependencies: ReplaceVersionDependencies,
  catalogOperationId?: string,
): Promise<
  ActionResult<Readonly<{ status: 'published'; cleanupPending: boolean; catalogWarning?: ActionError }>>
> {
  try {
    const id = z.string().uuid().parse(versionId);
    const operationId = catalogOperationId
      ? z.string().uuid().parse(catalogOperationId)
      : undefined;
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
      // The temporary draft object is no longer referenced once the publish
      // RPC has committed; clean it in the same pass as the replaced APKs.
      const draftAsset: CleanupAsset[] = draft.source === 'storage'
        ? (() => {
            const assetId = assetIdFromDraftPath(draft.draftPath);
            return assetId
              ? [{
                  bucket: 'apk-drafts' as const,
                  path: draft.draftPath,
                  assetId,
                  targetType: 'apk_draft' as const,
                }]
              : [];
          })()
        : [];
      const assets = [
        ...cleanupAssetsFromRpc(published.data, draft.appId),
        ...draftAsset,
      ];
      const cleanup = await dependencies.cleanupAssets(assets);
      cleanupPending = cleanup.queued > 0 || cleanup.enqueueFailures > 0;
    } catch {
      cleanupPending = true;
    }
    dependencies.revalidate?.(draft.appId);
    const catalogWarning = await refreshCatalogWarning(dependencies.refreshCatalog, operationId);
    return {
      ok: true,
      data: {
        status: 'published',
        cleanupPending,
        ...(catalogWarning ? { catalogWarning } : {}),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export function defaultReplaceVersionDependencies(): ReplaceVersionDependencies {
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
      return enqueueCleanupAssets(assets, {
        async enqueue(asset) {
          return enqueueCleanupAndAudit(db, {
            actorId: (await authorize()).userId,
            asset,
            auditAction: 'asset.cleanup_pending',
          });
        },
      });
    },
    revalidate(appId) {
      revalidatePath('/');
      revalidatePath('/publish');
      revalidatePath('/apps');
      revalidatePath(`/apps/${appId}`);
    },
    async refreshCatalog(input) {
      const { createCatalogRefreshAction } = await import('../catalog/catalog-json');
      return createCatalogRefreshAction(authorize)(input);
    },
  };
}

export async function withdrawVersion(
  versionId: string,
  dependencies: WithdrawVersionDependencies,
  catalogOperationId?: string,
): Promise<ActionResult<Readonly<{ status: 'withdrawn'; catalogWarning?: ActionError }>>> {
  try {
    const id = z.string().uuid().parse(versionId);
    const operationId = catalogOperationId
      ? z.string().uuid().parse(catalogOperationId)
      : undefined;
    const actor = await dependencies.authorize();
    const result = await dependencies.withdrawRpc(actor.userId, id);
    if (result.error) throw result.error;
    const catalogWarning = await refreshCatalogWarning(dependencies.refreshCatalog, operationId);
    return {
      ok: true,
      data: { status: 'withdrawn', ...(catalogWarning ? { catalogWarning } : {}) },
    };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}

export function defaultWithdrawDependencies(): WithdrawVersionDependencies {
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
    async withdrawRpc(actorId, versionId) {
      return (await database()).rpc('admin_withdraw_version', {
        p_actor_id: actorId,
        p_version_id: versionId,
      });
    },
    async refreshCatalog(input) {
      const { createCatalogRefreshAction } = await import('../catalog/catalog-json');
      return createCatalogRefreshAction(authorize)(input);
    },
  };
}
