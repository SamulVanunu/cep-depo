'use server';

import { z } from 'zod';

import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { APK_MIME_TYPES, finalizeUploadSchema, uploadIntentSchema } from './upload-schema';
import { requireAdmin } from '../../server/auth/require-admin';
import { getServerEnv } from '../../lib/env';
import type { Json } from '../../types/database.types';
import { storageAuthHeaders } from './storage-auth-headers';
import { resumableUploadEndpoint } from './upload-endpoint';

type Actor = Readonly<{ userId: string }>;
type StorageInspection = Readonly<{ size: number; mimeType: string }>;

export type UploadActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  appExists(appId: string): Promise<boolean>;
  createId(): string;
  signUpload(path: string): Promise<{
    data: Readonly<{ path: string; token: string }> | null;
    error: unknown | null;
  }>;
  inspectObject(path: string): Promise<StorageInspection | null>;
  readMagic(path: string): Promise<Uint8Array>;
  createDraft(input: Readonly<{
    actorId: string;
    appId: string;
    versionId: string;
    versionName: string;
    versionCode: number;
    changelog: string;
    draftPath: string;
    canonicalPath: string;
    size: number;
    sha256: string;
  }>): Promise<{ data: Readonly<{ id: string }> | null; error: unknown | null }>;
  recordAudit(input: Readonly<Record<string, unknown>>): Promise<{ error: unknown | null }>;
}>;

type RawUploadIntent = Readonly<{
  appId: string;
  fileName: string;
  mimeType: string;
  size: number;
  bucket?: string;
  path?: string;
}>;

export async function createUploadIntent(
  raw: RawUploadIntent,
  dependencies: UploadActionDependencies,
): Promise<ActionResult<Readonly<{
  operationId: string;
  bucket: 'apk-drafts';
  path: string;
  token: string;
}>>> {
  try {
    await dependencies.authorize();
    const input = uploadIntentSchema.parse(raw);
    if (!(await dependencies.appExists(input.appId))) throw new ActionException('NOT_FOUND');
    const operationId = dependencies.createId();
    const path = `operations/${operationId}/source.apk`;
    const signed = await dependencies.signUpload(path);
    if (signed.error || !signed.data) throw new ActionException('TEMPORARY');
    return { ok: true, data: { operationId, bucket: 'apk-drafts', path, token: signed.data.token } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

export async function finalizeUpload(
  raw: z.input<typeof finalizeUploadSchema>,
  dependencies: UploadActionDependencies,
): Promise<ActionResult<Readonly<{ id: string; status: 'draft' }>>> {
  try {
    const actor = await dependencies.authorize();
    const input = finalizeUploadSchema.parse(raw);
    if (!(await dependencies.appExists(input.appId))) throw new ActionException('NOT_FOUND');
    const draftPath = `operations/${input.operationId}/source.apk`;
    const object = await dependencies.inspectObject(draftPath);
    if (
      !object ||
      object.size !== input.size ||
      !APK_MIME_TYPES.includes(object.mimeType as (typeof APK_MIME_TYPES)[number])
    ) {
      throw new ActionException('VALIDATION');
    }
    const magic = await dependencies.readMagic(draftPath);
    if (magic[0] !== 0x50 || magic[1] !== 0x4b) throw new ActionException('VALIDATION');

    const versionId = dependencies.createId();
    const canonicalPath = `apps/${input.appId}/versions/${versionId}.apk`;
    const created = await dependencies.createDraft({
      actorId: actor.userId,
      appId: input.appId,
      versionId,
      versionName: input.versionName,
      versionCode: input.versionCode,
      changelog: input.changelog,
      draftPath,
      canonicalPath,
      size: input.size,
      sha256: input.sha256,
    });
    if (created.error) throw created.error;
    if (!created.data) throw new ActionException('INTERNAL');
    const audit = await dependencies.recordAudit({
      actorId: actor.userId,
      action: 'version.draft',
      targetType: 'version',
      targetId: created.data.id,
      metadata: { path: draftPath, version_code: input.versionCode },
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    return { ok: true, data: { id: created.data.id, status: 'draft' } };
  } catch (error) {
    return {
      ok: false,
      error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error),
    };
  }
}

function defaultDependencies(): UploadActionDependencies {
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
      const result = await db.from('apps').select('id').eq('id', appId).maybeSingle();
      if (result.error) throw result.error;
      return Boolean(result.data);
    },
    createId: () => crypto.randomUUID(),
    async signUpload(path) {
      const db = await database();
      return db.storage.from('apk-drafts').createSignedUploadUrl(path);
    },
    async inspectObject(path) {
      const db = await database();
      const result = await db.storage.from('apk-drafts').info(path);
      if (
        result.error ||
        !result.data ||
        typeof result.data.size !== 'number' ||
        typeof result.data.contentType !== 'string'
      ) return null;
      return { size: result.data.size, mimeType: result.data.contentType };
    },
    async readMagic(path) {
      await authorize();
      const env = getServerEnv();
      const response = await fetch(
        `${env.supabaseUrl}/storage/v1/object/authenticated/apk-drafts/${path.split('/').map(encodeURIComponent).join('/')}`,
        {
          headers: { ...storageAuthHeaders(env.supabaseSecretKey), Range: 'bytes=0-1' },
          cache: 'no-store',
        },
      );
      if (!response.ok) throw new ActionException('TEMPORARY');
      return new Uint8Array(await response.arrayBuffer());
    },
    async createDraft(input) {
      const db = await database();
      return db.from('app_versions').insert({
        id: input.versionId,
        app_id: input.appId,
        version_name: input.versionName,
        version_code: input.versionCode,
        changelog: input.changelog,
        apk_path: input.canonicalPath,
        apk_size_bytes: input.size,
        sha256: input.sha256,
        status: 'draft',
        created_by: input.actorId,
      }).select('id').single();
    },
    async recordAudit(input) {
      const db = await database();
      return db.rpc('admin_record_external_action', {
        p_actor_id: String(input.actorId),
        p_action: String(input.action),
        p_target_type: String(input.targetType),
        p_target_id: String(input.targetId),
        p_metadata: (input.metadata ?? {}) as Json,
      });
    },
  };
}

export async function createUploadIntentAction(raw: RawUploadIntent) {
  const result = await createUploadIntent(raw, defaultDependencies());
  if (!result.ok) return result;
  return {
    ...result,
    data: {
      ...result.data,
      endpoint: resumableUploadEndpoint(getServerEnv().supabaseUrl),
    },
  };
}

export async function finalizeUploadAction(raw: z.input<typeof finalizeUploadSchema>) {
  return finalizeUpload(raw, defaultDependencies());
}
