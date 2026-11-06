'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../server/auth/require-admin';
import { logger } from '../../server/observability/logger';
import type { Json } from '../../types/database.types';
import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { enqueueCleanupAssets, type CleanupAsset, type CleanupOutcome } from '../uploads/asset-cleanup';
import { enqueueCleanupAndAudit } from '../uploads/cleanup-enqueue';
import { managedTarget } from '../uploads/cleanup-paths';

const MAX_ASSET_SIZE = 10_485_760;
const mimeExtensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

const uploadIntentSchema = z.object({
  appId: z.string().uuid(),
  kind: z.enum(['icon', 'screenshot']),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z.number().int().positive().max(MAX_ASSET_SIZE),
});

type UploadIntentInput = Readonly<{
  appId: string;
  kind: string;
  fileName: string;
  mimeType: string;
  size: number;
}>;
type Actor = Readonly<{ userId: string }>;

export type AssetActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  appExists(appId: string): Promise<boolean>;
  createId(): string;
  createSignedUpload(path: string): Promise<{
    data: Readonly<{ path: string; token: string }> | null;
    error: unknown | null;
  }>;
}>;

function defaultDependencies(): AssetActionDependencies {
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
    async appExists(appId) {
      const db = await database();
      const { data, error } = await db.from('apps').select('id').eq('id', appId).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    createId: () => crypto.randomUUID(),
    async createSignedUpload(path) {
      const db = await database();
      return db.storage.from('app-assets').createSignedUploadUrl(path);
    },
  };
}

export type AssetUploadIntent = Readonly<{
  bucket: 'app-assets';
  path: string;
  token: string;
}>;

export type PublishingAssetCleanupDependencies = Readonly<{
  authorize(): Promise<Actor>;
  cleanupAssets(assets: readonly CleanupAsset[]): Promise<CleanupOutcome>;
}>;

function defaultPublishingAssetCleanupDependencies(): PublishingAssetCleanupDependencies {
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
  };
}

export type AssetMutationDependencies = Readonly<{
  authorize(): Promise<Actor>;
  readAppIconPath(appId: string): Promise<string | null>;
  updateAppIcon(appId: string, path: string): Promise<{ error: unknown | null }>;
  readScreenshotPath(appId: string, screenshotId: string): Promise<string | null>;
  deleteScreenshotRow(appId: string, screenshotId: string): Promise<{ error: unknown | null }>;
  recordAudit(input: Readonly<{
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Json;
  }>): Promise<{ error: unknown | null }>;
  cleanupAssets(assets: readonly CleanupAsset[]): Promise<CleanupOutcome>;
}>;

export async function cleanupPublishingAsset(
  rawInput: Readonly<{
    appId: string;
    requestId: string;
    path: string;
    kind: 'icon' | 'screenshot';
  }>,
  dependencies: PublishingAssetCleanupDependencies = defaultPublishingAssetCleanupDependencies(),
): Promise<ActionResult<Readonly<{ cleanupPending: boolean }>>> {
  try {
    await dependencies.authorize();
    const input = z.object({
      appId: z.string().uuid(),
      requestId: z.string().uuid(),
      path: z.string(),
      kind: z.enum(['icon', 'screenshot']),
    }).parse(rawInput);
    // The browser names only a Storage target. The asset identity must come
    // from that validated path; the request id is tracking context and may be
    // shared by several different assets in one publishing operation.
    const target = managedTarget('app-assets', input.path, input.kind);
    if (!target || !input.path.startsWith(`apps/${input.appId}/`)) {
      throw new ActionException('VALIDATION');
    }
    const cleanup = await dependencies.cleanupAssets([{
      bucket: 'app-assets',
      path: target.path,
      assetId: target.assetId,
      targetType: input.kind,
    }]);
    if (cleanup.enqueueFailures > 0) {
      logger.error({
        correlationId: input.requestId,
        operation: 'asset.cleanup',
        targetId: target.assetId,
        targetType: target.targetType,
        error: new Error('Cleanup enqueue failed.'),
      });
    }
    return { ok: true, data: { cleanupPending: cleanup.queued > 0 || cleanup.enqueueFailures > 0 } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function cleanupPublishingAssetAction(rawInput: Readonly<{
  appId: string;
  requestId: string;
  path: string;
  kind: 'icon' | 'screenshot';
}>) {
  return cleanupPublishingAsset(rawInput);
}

export async function createAssetUploadIntent(
  rawInput: UploadIntentInput,
  dependencies: AssetActionDependencies = defaultDependencies(),
): Promise<ActionResult<AssetUploadIntent>> {
  try {
    await dependencies.authorize();
    const input = uploadIntentSchema.parse(rawInput);
    if (!(await dependencies.appExists(input.appId))) throw new ActionException('NOT_FOUND');

    const folder = input.kind === 'icon' ? 'icons' : 'screenshots';
    const extension = mimeExtensions[input.mimeType];
    const path = `apps/${input.appId}/${folder}/${dependencies.createId()}.${extension}`;
    const signed = await dependencies.createSignedUpload(path);
    if (signed.error) throw signed.error;
    if (!signed.data) throw new ActionException('INTERNAL');

    return {
      ok: true,
      data: { bucket: 'app-assets', path, token: signed.data.token },
    };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function requestAssetUploadAction(rawInput: UploadIntentInput) {
  return createAssetUploadIntent(rawInput);
}

async function getAssetMutationContext() {
  const identity = await requireAdmin(undefined, { mutation: true });
  const { getAdminClient } = await import('../../server/supabase/admin-client');
  return { identity, client: getAdminClient(identity) };
}

function isRetiredAssetError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'CLN02',
  );
}

async function cleanupPreviousAsset(
  dependencies: AssetMutationDependencies,
  path: string,
  kind: 'icon' | 'screenshot',
): Promise<void> {
  const target = managedTarget('app-assets', path, kind);
  if (!target) return;

  try {
    await dependencies.cleanupAssets([{
      bucket: 'app-assets',
      path: target.path,
      assetId: target.assetId,
      targetType: kind,
    }]);
  } catch (error) {
    // The row no longer references the object, so the sweeper can recover it.
    // Failing the whole action here would report a successful edit as failed.
    logger.error({
      correlationId: crypto.randomUUID(),
      operation: 'asset.cleanup',
      targetId: target.path,
      targetType: kind,
      error,
    });
  }
}

function defaultAssetMutationDependencies(): AssetMutationDependencies {
  const cleanup = defaultPublishingAssetCleanupDependencies();
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
    async readAppIconPath(appId) {
      const db = await database();
      const { data, error } = await db
        .from('apps')
        .select('icon_path')
        .eq('id', appId)
        .maybeSingle();
      if (error) throw error;
      return data?.icon_path ?? null;
    },
    async updateAppIcon(appId, path) {
      const db = await database();
      return db.from('apps').update({ icon_path: path }).eq('id', appId);
    },
    async readScreenshotPath(appId, screenshotId) {
      const db = await database();
      const { data, error } = await db
        .from('app_screenshots')
        .select('path')
        .eq('id', screenshotId)
        .eq('app_id', appId)
        .maybeSingle();
      if (error) throw error;
      return data?.path ?? null;
    },
    async deleteScreenshotRow(appId, screenshotId) {
      const db = await database();
      return db
        .from('app_screenshots')
        .delete()
        .eq('id', screenshotId)
        .eq('app_id', appId);
    },
    async recordAudit(input) {
      const db = await database();
      return db.rpc('admin_record_external_action', {
        p_actor_id: input.actorId,
        p_action: input.action,
        p_target_type: input.targetType,
        p_target_id: input.targetId,
        p_metadata: input.metadata,
      });
    },
    cleanupAssets: assets => cleanup.cleanupAssets(assets),
  };
}

export async function setAppIconAction(
  appId: string,
  path: string,
  dependencies: AssetMutationDependencies = defaultAssetMutationDependencies(),
): Promise<ActionResult<null>> {
  try {
    const input = z.object({
      appId: z.string().uuid(),
      path: z.string().regex(/^apps\/[0-9a-f-]{36}\/icons\/[0-9a-f-]{36}\.(png|jpg|webp)$/),
    }).refine(value => value.path.startsWith(`apps/${value.appId}/icons/`)).parse({ appId, path });
    const identity = await dependencies.authorize();
    const previousPath = await dependencies.readAppIconPath(input.appId);
    const update = await dependencies.updateAppIcon(input.appId, input.path);
    if (update.error) throw update.error;
    const audit = await dependencies.recordAudit({
      actorId: identity.userId,
      action: 'asset.upload',
      targetType: 'asset',
      targetId: input.path,
      metadata: { bucket: 'app-assets', path: input.path },
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    if (previousPath && previousPath !== input.path) {
      await cleanupPreviousAsset(dependencies, previousPath, 'icon');
    }
    revalidatePath(`/apps/${input.appId}`);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(
        isRetiredAssetError(error)
          ? new ActionException('RETIRED_ASSET')
          : error instanceof z.ZodError
            ? new ActionException('VALIDATION')
            : error,
      ),
    };
  }
}

export async function addScreenshotAction(input: Readonly<{
  appId: string;
  path: string;
  altText: string;
  position: number;
}>): Promise<ActionResult<null>> {
  try {
    const parsed = z.object({
      appId: z.string().uuid(),
      path: z.string().regex(/^apps\/[0-9a-f-]{36}\/screenshots\/[0-9a-f-]{36}\.(png|jpg|webp)$/),
      altText: z.string().trim().min(2).max(180),
      position: z.number().int().min(0),
    }).refine(value => value.path.startsWith(`apps/${value.appId}/screenshots/`)).parse(input);
    const { identity, client } = await getAssetMutationContext();
    const insert = await client.from('app_screenshots').insert({
      app_id: parsed.appId,
      path: parsed.path,
      alt_text: parsed.altText,
      position: parsed.position,
    });
    if (insert.error) throw insert.error;
    const audit = await client.rpc('admin_record_external_action', {
      p_actor_id: identity.userId,
      p_action: 'screenshot.create',
      p_target_type: 'screenshot',
      p_target_id: parsed.path,
      p_metadata: { bucket: 'app-assets', path: parsed.path },
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    revalidatePath(`/apps/${parsed.appId}`);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function updateScreenshotAction(input: Readonly<{
  appId: string;
  screenshotId: string;
  altText: string;
  position: number;
}>): Promise<ActionResult<null>> {
  try {
    const parsed = z.object({
      appId: z.string().uuid(),
      screenshotId: z.string().uuid(),
      altText: z.string().trim().min(2).max(180),
      position: z.number().int().min(0),
    }).parse(input);
    const { identity, client } = await getAssetMutationContext();
    const update = await client
      .from('app_screenshots')
      .update({ alt_text: parsed.altText, position: parsed.position })
      .eq('id', parsed.screenshotId)
      .eq('app_id', parsed.appId);
    if (update.error) throw update.error;
    const audit = await client.rpc('admin_record_external_action', {
      p_actor_id: identity.userId,
      p_action: 'screenshot.update',
      p_target_type: 'screenshot',
      p_target_id: parsed.screenshotId,
      p_metadata: {},
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    revalidatePath(`/apps/${parsed.appId}`);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function deleteScreenshotAction(
  appId: string,
  screenshotId: string,
  dependencies: AssetMutationDependencies = defaultAssetMutationDependencies(),
): Promise<ActionResult<null>> {
  try {
    const parsed = z.object({ appId: z.string().uuid(), screenshotId: z.string().uuid() })
      .parse({ appId, screenshotId });
    const identity = await dependencies.authorize();
    // Read the path before deleting the row: afterwards nothing points at the
    // object and only the sweeper could find it.
    const screenshotPath = await dependencies.readScreenshotPath(
      parsed.appId,
      parsed.screenshotId,
    );
    const removal = await dependencies.deleteScreenshotRow(parsed.appId, parsed.screenshotId);
    if (removal.error) throw removal.error;
    const audit = await dependencies.recordAudit({
      actorId: identity.userId,
      action: 'screenshot.delete',
      targetType: 'screenshot',
      targetId: parsed.screenshotId,
      metadata: {},
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    if (screenshotPath) {
      await cleanupPreviousAsset(dependencies, screenshotPath, 'screenshot');
    }
    revalidatePath(`/apps/${parsed.appId}`);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(
        isRetiredAssetError(error)
          ? new ActionException('RETIRED_ASSET')
          : error instanceof z.ZodError
            ? new ActionException('VALIDATION')
            : error,
      ),
    };
  }
}
