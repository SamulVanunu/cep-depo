'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '../../server/auth/require-admin';
import type { ActionError, ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { parseAppFormData, parseCategoryFormData } from './app-schema';

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
    if (!(await dependencies.categoryExists(input.categoryId))) {
      throw new ActionException('VALIDATION');
    }

    const insert = await dependencies.insertApp({
      category_id: input.categoryId,
      slug: input.slug,
      title: input.title,
      short_description: input.shortDescription,
      description: input.description,
      featured: input.featured,
      status: input.status,
    });
    if (insert.error) throw insert.error;
    if (!insert.data) throw new ActionException('INTERNAL');

    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'app.create',
      targetType: 'app',
      targetId: insert.data.id,
      metadata: { status: input.status },
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

export async function updateApp(
  appId: string,
  formData: FormData,
  dependencies: CatalogActionDependencies = defaultDependencies(),
): Promise<ActionResult<CatalogMutationData>> {
  try {
    const id = z.string().uuid().parse(appId);
    const actor = await dependencies.authorize();
    const input = parseAppFormData(formData);
    if (!(await dependencies.categoryExists(input.categoryId))) throw new ActionException('VALIDATION');
    const update = await dependencies.updateApp(id, {
      category_id: input.categoryId,
      slug: input.slug,
      title: input.title,
      short_description: input.shortDescription,
      description: input.description,
      featured: input.featured,
      status: input.status,
    });
    if (update.error) throw update.error;
    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'app.update',
      targetType: 'app',
      targetId: id,
      metadata: { status: input.status },
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

export async function archiveApp(
  appId: string,
  dependencies: CatalogActionDependencies = defaultDependencies(),
): Promise<ActionResult<CatalogMutationData>> {
  try {
    const id = z.string().uuid().parse(appId);
    const actor = await dependencies.authorize();
    const update = await dependencies.updateApp(id, { status: 'archived' });
    if (update.error) throw update.error;
    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'app.archive',
      targetType: 'app',
      targetId: id,
      metadata: { new_status: 'archived' },
    });
    dependencies.revalidate?.('/apps');
    return { ok: true, data: { id, ...(auditWarning ? { auditWarning } : {}) } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
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

export async function updateAppAction(
  appId: string,
  _previous: ActionResult<CatalogMutationData> | null,
  formData: FormData,
) {
  return updateApp(appId, formData);
}

export async function setAppStatusAction(appId: string, status: 'active' | 'archived') {
  if (status === 'archived') return archiveApp(appId);

  const dependencies = defaultDependencies();
  try {
    const id = z.string().uuid().parse(appId);
    const actor = await dependencies.authorize();
    const update = await dependencies.updateApp(id, { status: 'active' });
    if (update.error) throw update.error;
    const auditWarning = await auditMutation(dependencies, {
      actorId: actor.userId,
      action: 'app.update',
      targetType: 'app',
      targetId: id,
      metadata: { new_status: 'active' },
    });
    dependencies.revalidate?.('/apps');
    return { ok: true, data: { id, ...(auditWarning ? { auditWarning } : {}) } } as const;
  } catch (error) {
    return { ok: false, error: toActionError(error) } as const;
  }
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
