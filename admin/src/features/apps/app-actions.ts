'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Json } from '../../types/database.types';
import { requireAdmin } from '../../server/auth/require-admin';
import type { ActionError, ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { removeOrEnqueueAssets, type CleanupAsset } from '../uploads/asset-cleanup';
import {
  parseAppFormData,
  parseCategoryFormData,
  parsePublishingAppInput,
  parseQuickAppInput,
  type PublishingAppInput,
} from './app-schema';

type MutationError = Readonly<{ code?: string; message?: string }> | null;
type Actor = Readonly<{ userId: string }>;

type AuditInput = Readonly<{
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Readonly<Record<string, string | number | boolean>>;
}>;

export type CatalogActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  categoryExists(categoryId: string): Promise<boolean>;
  categoryIsDefault(categoryId: string): Promise<boolean>;
  getDefaultCategoryId(): Promise<string | null>;
  insertApp(input: Readonly<Record<string, unknown>>): Promise<{
    data: Readonly<{ id: string }> | null;
    error: MutationError;
  }>;
  updateApp(appId: string, input: Readonly<Record<string, unknown>>): Promise<{ error: MutationError }>;
  insertCategory(input: Readonly<Record<string, unknown>>): Promise<{
    data: Readonly<{ id: string }> | null;
    error: MutationError;
  }>;
  updateCategory(categoryId: string, input: Readonly<Record<string, unknown>>): Promise<{ error: MutationError }>;
  recordAudit(input: AuditInput): Promise<{ error: MutationError }>;
  revalidate?(path: string): void;
}>;

export type CatalogMutationData = Readonly<{
  id: string;
  auditWarning?: ActionError;
}>;

export type PublishingAppData = Readonly<{
  id: string;
  slug: string;
  status: 'archived';
  operationId: string;
}>;

export type PublishingAppActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  categoryIsActive(categoryId: string): Promise<boolean>;
  insertApp(input: Readonly<Record<string, unknown>>): Promise<{
    data: Readonly<{ id: string }> | null;
    error: MutationError;
  }>;
  recordAudit(input: AuditInput): Promise<{ error: MutationError }>;
  createOperationId(): string;
  revalidate?(path: string): void;
}>;

export type AppPublicationStatus = 'active' | 'archived';
export type LifecycleMutationData = Readonly<{ id: string; status: AppPublicationStatus }>;
export type DeleteAppData = Readonly<{ deleted: true; cleanupPending: boolean }>;

export type LifecycleActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  setStatusRpc(
    actorId: string,
    appId: string,
    status: AppPublicationStatus,
  ): Promise<{ error: unknown | null }>;
  deleteRpc(
    actorId: string,
    appId: string,
    confirmationTitle: string,
  ): Promise<{ data: unknown; error: unknown | null }>;
  cleanupAssets(assets: readonly CleanupAsset[]): Promise<{ pending: number }>;
  revalidate?(appId: string): void;
}>;

function defaultLifecycleDependencies(): LifecycleActionDependencies {
  let actor: Awaited<ReturnType<typeof requireAdmin>> | null = null;
  let client: ReturnType<typeof import('../../server/supabase/admin-client')['getAdminClient']> | null = null;

  async function authorize() {
    actor ??= await requireAdmin(undefined, { mutation: true });
    return actor;
  }

  async function database() {
    const identity = await authorize();
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    client ??= getAdminClient(identity);
    return client;
  }

  return {
    authorize,
    async setStatusRpc(actorId, appId, status) {
      return (await database()).rpc('admin_set_app_publication_status', {
        p_actor_id: actorId,
        p_app_id: appId,
        p_status: status,
      });
    },
    async deleteRpc(actorId, appId, confirmationTitle) {
      return (await database()).rpc('admin_delete_app_permanently', {
        p_actor_id: actorId,
        p_app_id: appId,
        p_confirmation_title: confirmationTitle,
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
      revalidatePath('/apps');
      revalidatePath(`/apps/${appId}`);
    },
  };
}

const uuidPart = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function cleanupAssetsFromDeleteResult(value: unknown, appId: string): CleanupAsset[] {
  if (!Array.isArray(value)) throw new ActionException('INTERNAL');
  const escapedAppId = appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const apk = new RegExp(`^apps/${escapedAppId}/versions/(${uuidPart})\\.apk$`);
  const image = new RegExp(`^apps/${escapedAppId}/(icons|screenshots)/(${uuidPart})\\.(png|jpg|webp)$`);

  return value.map(item => {
    if (!item || typeof item !== 'object') throw new ActionException('INTERNAL');
    const { bucket, path } = item as { bucket?: unknown; path?: unknown };
    if (typeof path !== 'string') throw new ActionException('INTERNAL');
    const apkMatch = bucket === 'apks' ? apk.exec(path) : null;
    if (apkMatch) {
      return { bucket: 'apks', path, operationId: apkMatch[1], targetType: 'apk' };
    }
    const imageMatch = bucket === 'app-assets' ? image.exec(path) : null;
    if (!imageMatch) throw new ActionException('INTERNAL');
    return {
      bucket: 'app-assets',
      path,
      operationId: imageMatch[2],
      targetType: imageMatch[1] === 'icons' ? 'icon' : 'screenshot',
    };
  });
}

export async function setAppPublicationStatus(
  appId: string,
  status: AppPublicationStatus,
  dependencies: LifecycleActionDependencies = defaultLifecycleDependencies(),
): Promise<ActionResult<LifecycleMutationData>> {
  try {
    const actor = await dependencies.authorize();
    const id = z.string().uuid().parse(appId);
    const nextStatus = z.enum(['active', 'archived']).parse(status);
    const result = await dependencies.setStatusRpc(actor.userId, id, nextStatus);
    if (result.error) throw result.error;
    dependencies.revalidate?.(id);
    return { ok: true, data: { id, status: nextStatus } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function deleteAppPermanently(
  appId: string,
  confirmationTitle: string,
  dependencies: LifecycleActionDependencies = defaultLifecycleDependencies(),
): Promise<ActionResult<DeleteAppData>> {
  try {
    const actor = await dependencies.authorize();
    const id = z.string().uuid().parse(appId);
    const confirmation = z.string().min(1).max(90).parse(confirmationTitle);
    const result = await dependencies.deleteRpc(actor.userId, id, confirmation);
    if (result.error || !result.data) throw result.error ?? new ActionException('INTERNAL');

    let cleanupPending = false;
    try {
      const assets = cleanupAssetsFromDeleteResult(result.data, id);
      const cleanup = await dependencies.cleanupAssets(assets);
      cleanupPending = cleanup.pending > 0;
    } catch {
      cleanupPending = true;
    }
    dependencies.revalidate?.(id);
    return { ok: true, data: { deleted: true, cleanupPending } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

function defaultDependencies(): CatalogActionDependencies {
  let actor: Awaited<ReturnType<typeof requireAdmin>> | null = null;
  let client: ReturnType<typeof import('../../server/supabase/admin-client')['getAdminClient']> | null = null;

  async function authorize() {
    actor ??= await requireAdmin(undefined, { mutation: true });
    return actor;
  }

  async function database() {
    const identity = await authorize();
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    client ??= getAdminClient(identity);
    return client;
  }

  return {
    authorize,
    async categoryExists(categoryId) {
      const db = await database();
      const { data, error } = await db.from('categories').select('id').eq('id', categoryId).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async categoryIsDefault(categoryId) {
      const db = await database();
      const { data, error } = await db
        .from('categories')
        .select('is_default')
        .eq('id', categoryId)
        .maybeSingle();
      if (error) throw error;
      return data?.is_default ?? false;
    },
    async getDefaultCategoryId() {
      const db = await database();
      const { data, error } = await db
        .from('categories')
        .select('id')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    async insertApp(input) {
      const db = await database();
      return db.from('apps').insert(input as never).select('id').single();
    },
    async updateApp(appId, input) {
      const db = await database();
      return db.from('apps').update(input as never).eq('id', appId);
    },
    async insertCategory(input) {
      const db = await database();
      return db.from('categories').insert(input as never).select('id').single();
    },
    async updateCategory(categoryId, input) {
      const db = await database();
      return db.from('categories').update(input as never).eq('id', categoryId);
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
    revalidate: revalidatePath,
  };
}

function defaultPublishingDependencies(): PublishingAppActionDependencies {
  let actor: Awaited<ReturnType<typeof requireAdmin>> | null = null;
  let client: ReturnType<typeof import('../../server/supabase/admin-client')['getAdminClient']> | null = null;

  async function authorize() {
    actor ??= await requireAdmin(undefined, { mutation: true });
    return actor;
  }

  async function database() {
    const identity = await authorize();
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    client ??= getAdminClient(identity);
    return client;
  }

  return {
    authorize,
    async categoryIsActive(categoryId) {
      const { data, error } = await (await database())
        .from('categories')
        .select('id')
        .eq('id', categoryId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async insertApp(input) {
      return (await database()).from('apps').insert(input as never).select('id').single();
    },
    async recordAudit(input) {
      return (await database()).rpc('admin_record_external_action', {
        p_actor_id: input.actorId,
        p_action: input.action,
        p_target_type: input.targetType,
        p_target_id: input.targetId,
        p_metadata: input.metadata,
      });
    },
    createOperationId: () => crypto.randomUUID(),
    revalidate: revalidatePath,
  };
}

export async function resolveAppCategoryId(
  requestedCategoryId: string | null,
  dependencies: Pick<CatalogActionDependencies, 'categoryExists' | 'getDefaultCategoryId'>,
): Promise<string> {
  if (requestedCategoryId) {
    if (await dependencies.categoryExists(requestedCategoryId)) return requestedCategoryId;
    throw new ActionException('VALIDATION');
  }

  const defaultCategoryId = await dependencies.getDefaultCategoryId();
  if (!defaultCategoryId) throw new ActionException('VALIDATION');
  return defaultCategoryId;
}

async function auditMutation(
  dependencies: CatalogActionDependencies,
  input: AuditInput,
): Promise<ActionError | undefined> {
  const audit = await dependencies.recordAudit(input);
  return audit.error ? toActionError(new ActionException('TEMPORARY')) : undefined;
}

export async function createApp(
  formData: FormData,
  dependencies: CatalogActionDependencies = defaultDependencies(),
): Promise<ActionResult<CatalogMutationData>> {
  try {
    const actor = await dependencies.authorize();
    const input = parseAppFormData(formData);
    const categoryId = await resolveAppCategoryId(input.categoryId, dependencies);

    const insert = await dependencies.insertApp({
      category_id: categoryId,
      slug: input.slug,
      title: input.title,
      short_description: input.shortDescription,
      description: input.description,
      featured: input.featured,
      status: 'archived',
    });
    if (insert.error) throw insert.error;
    if (!insert.data) throw new ActionException('INTERNAL');

    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'app.create',
      targetType: 'app',
      targetId: insert.data.id,
      metadata: { status: 'archived' },
    });
    dependencies.revalidate?.('/apps');
    return { ok: true, data: { id: insert.data.id, ...(auditWarning ? { auditWarning } : {}) } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function createPublishingApp(
  raw: PublishingAppInput,
  dependencies: PublishingAppActionDependencies = defaultPublishingDependencies(),
): Promise<ActionResult<PublishingAppData>> {
  try {
    const actor = await dependencies.authorize();
    const input = parsePublishingAppInput(raw);
    if (!(await dependencies.categoryIsActive(input.categoryId))) {
      throw new ActionException('VALIDATION');
    }
    const operationId = z.string().uuid().parse(dependencies.createOperationId());
    const insert = await dependencies.insertApp({
      category_id: input.categoryId,
      slug: input.slug,
      title: input.title,
      short_description: input.shortDescription,
      description: input.description,
      featured: input.featured,
      status: 'archived',
    });
    if (insert.error) throw insert.error;
    if (!insert.data) throw new ActionException('INTERNAL');
    const audit = await dependencies.recordAudit({
      actorId: actor.userId,
      action: 'app.create',
      targetType: 'app',
      targetId: insert.data.id,
      metadata: { status: 'archived' },
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    dependencies.revalidate?.('/publish');
    dependencies.revalidate?.('/apps');
    return {
      ok: true,
      data: { id: insert.data.id, slug: input.slug, status: 'archived', operationId },
    };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function updateApp(
  appId: string,
  formData: FormData,
  dependencies: CatalogActionDependencies = defaultDependencies(),
): Promise<ActionResult<CatalogMutationData>> {
  try {
    const id = z.string().uuid().parse(appId);
    const actor = await dependencies.authorize();
    const input = parseAppFormData(formData);
    const categoryId = await resolveAppCategoryId(input.categoryId, dependencies);
    const update = await dependencies.updateApp(id, {
      category_id: categoryId,
      slug: input.slug,
      title: input.title,
      short_description: input.shortDescription,
      description: input.description,
      featured: input.featured,
    });
    if (update.error) throw update.error;
    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'app.update',
      targetType: 'app',
      targetId: id,
      metadata: {},
    });
    dependencies.revalidate?.(`/apps/${id}`);
    return { ok: true, data: { id, ...(auditWarning ? { auditWarning } : {}) } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

type QuickAppData = Readonly<{
  id: string;
  slug: string;
  status: 'archived';
  auditWarning?: ActionError;
}>;

export async function createQuickApp(
  raw: unknown,
  dependencies: CatalogActionDependencies = defaultDependencies(),
): Promise<ActionResult<QuickAppData>> {
  try {
    const actor = await dependencies.authorize();
    const input = parseQuickAppInput(raw);
    const categoryId = await resolveAppCategoryId(null, dependencies);
    const insert = await dependencies.insertApp({
      category_id: categoryId,
      slug: input.slug,
      title: input.title,
      short_description: input.shortDescription,
      description: input.shortDescription,
      featured: false,
      status: 'archived',
    });
    if (insert.error) throw insert.error;
    if (!insert.data) throw new ActionException('INTERNAL');

    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'app.create',
      targetType: 'app',
      targetId: insert.data.id,
      metadata: { status: 'archived' },
    });
    dependencies.revalidate?.('/');
    dependencies.revalidate?.('/publish');
    dependencies.revalidate?.('/apps');
    return {
      ok: true,
      data: {
        id: insert.data.id,
        slug: input.slug,
        status: 'archived',
        ...(auditWarning ? { auditWarning } : {}),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function archiveApp(
  appId: string,
  dependencies: LifecycleActionDependencies = defaultLifecycleDependencies(),
): Promise<ActionResult<LifecycleMutationData>> {
  return setAppPublicationStatus(appId, 'archived', dependencies);
}

export async function createCategory(
  formData: FormData,
  dependencies: CatalogActionDependencies = defaultDependencies(),
): Promise<ActionResult<CatalogMutationData>> {
  try {
    const actor = await dependencies.authorize();
    const input = parseCategoryFormData(formData);
    const insert = await dependencies.insertCategory({
      name: input.name,
      slug: input.slug,
      position: input.position,
      is_active: input.isActive,
    });
    if (insert.error) throw insert.error;
    if (!insert.data) throw new ActionException('INTERNAL');
    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'category.create',
      targetType: 'category',
      targetId: insert.data.id,
      metadata: {},
    });
    dependencies.revalidate?.('/apps');
    dependencies.revalidate?.('/settings');
    return { ok: true, data: { id: insert.data.id, ...(auditWarning ? { auditWarning } : {}) } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function updateCategory(
  categoryId: string,
  formData: FormData,
  dependencies: CatalogActionDependencies = defaultDependencies(),
): Promise<ActionResult<CatalogMutationData>> {
  try {
    const id = z.string().uuid().parse(categoryId);
    const actor = await dependencies.authorize();
    const input = parseCategoryFormData(formData);
    if (!input.isActive && await dependencies.categoryIsDefault(id)) {
      throw new ActionException('VALIDATION');
    }
    const update = await dependencies.updateCategory(id, {
      name: input.name,
      slug: input.slug,
      position: input.position,
      is_active: input.isActive,
    });
    if (update.error) throw update.error;
    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'category.update',
      targetType: 'category',
      targetId: id,
      metadata: {},
    });
    dependencies.revalidate?.('/apps');
    dependencies.revalidate?.('/settings');
    return { ok: true, data: { id, ...(auditWarning ? { auditWarning } : {}) } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function createAppAction(
  _previous: ActionResult<CatalogMutationData> | null,
  formData: FormData,
) {
  return createApp(formData);
}

export async function createQuickAppAction(raw: unknown) {
  return createQuickApp(raw);
}

export async function createPublishingAppAction(raw: PublishingAppInput) {
  return createPublishingApp(raw);
}

export async function updateAppAction(
  appId: string,
  _previous: ActionResult<CatalogMutationData> | null,
  formData: FormData,
) {
  return updateApp(appId, formData);
}

export async function setAppStatusAction(appId: string, status: 'active' | 'archived') {
  return setAppPublicationStatus(appId, status);
}

export async function setAppPublicationStatusAction(appId: string, status: AppPublicationStatus) {
  return setAppPublicationStatus(appId, status);
}

export async function deleteAppPermanentlyAction(appId: string, confirmationTitle: string) {
  return deleteAppPermanently(appId, confirmationTitle);
}

export async function setAppStatusFormAction(
  appId: string,
  status: 'active' | 'archived',
  _previous: ActionResult<CatalogMutationData> | null,
) {
  void _previous;
  return setAppStatusAction(appId, status);
}

export async function createCategoryAction(
  _previous: ActionResult<CatalogMutationData> | null,
  formData: FormData,
) {
  return createCategory(formData);
}

export async function updateCategoryAction(
  categoryId: string,
  _previous: ActionResult<CatalogMutationData> | null,
  formData: FormData,
) {
  return updateCategory(categoryId, formData);
}
