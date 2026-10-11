'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../server/auth/require-admin';
import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';

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

export async function setAppIconAction(appId: string, path: string): Promise<ActionResult<null>> {
  try {
    const input = z.object({
      appId: z.string().uuid(),
      path: z.string().regex(/^apps\/[0-9a-f-]{36}\/icons\/[0-9a-f-]{36}\.(png|jpg|webp)$/),
    }).refine(value => value.path.startsWith(`apps/${value.appId}/icons/`)).parse({ appId, path });
    const { identity, client } = await getAssetMutationContext();
    const update = await client.from('apps').update({ icon_path: input.path }).eq('id', input.appId);
    if (update.error) throw update.error;
    const audit = await client.rpc('admin_record_external_action', {
      p_actor_id: identity.userId,
      p_action: 'asset.upload',
      p_target_type: 'asset',
      p_target_id: input.path,
      p_metadata: { bucket: 'app-assets', path: input.path },
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    revalidatePath(`/apps/${input.appId}`);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
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
): Promise<ActionResult<null>> {
  try {
    const parsed = z.object({ appId: z.string().uuid(), screenshotId: z.string().uuid() })
      .parse({ appId, screenshotId });
    const { identity, client } = await getAssetMutationContext();
    const removal = await client
      .from('app_screenshots')
      .delete()
      .eq('id', parsed.screenshotId)
      .eq('app_id', parsed.appId);
    if (removal.error) throw removal.error;
    const audit = await client.rpc('admin_record_external_action', {
      p_actor_id: identity.userId,
      p_action: 'screenshot.delete',
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
