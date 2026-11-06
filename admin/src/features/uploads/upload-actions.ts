'use server';

import { z } from 'zod';

import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import {
  APK_MIME_TYPES,
  finalizeUploadSchema,
  HOSTED_STORAGE_MAX_BYTES,
  uploadIntentSchema,
} from './upload-schema';
import { requireAdmin } from '../../server/auth/require-admin';
import { getServerEnv } from '../../lib/env';
import type { Json } from '../../types/database.types';
import type { VerifiedApk } from './apk-verification';
import { assertDeclaredApkMatches, verifyApkBytes } from './apk-verification';
import { enqueueCleanupAssets } from './asset-cleanup';
import { managedTarget } from './cleanup-paths';
import { enqueueCleanupAndAudit } from './cleanup-enqueue';
import { createStorageApkSource } from './storage-apk-source';
import { resumableUploadEndpoint } from './upload-endpoint';

type Actor = Readonly<{ userId: string }>;
type StorageInspection = Readonly<{ size: number; mimeType: string }>;
type CleanupTarget = Readonly<{ path: string }>;

export type UploadActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  appExists(appId: string): Promise<boolean>;
  createId(): string;
  signUpload(path: string): Promise<{
    data: Readonly<{ path: string; token: string }> | null;
    error: unknown | null;
  }>;
  inspectObject(path: string): Promise<StorageInspection | null>;
  /** Parses the real object bytes and recomputes the digest on the server. */
  verifyApk(path: string, size: number): Promise<VerifiedApk>;
  /** Best effort: removes (or queues) a failed draft object; never throws. */
  cleanupDraft(path: string): Promise<void>;
  createDraft(input: Readonly<{
    actorId: string;
    appId: string;
    versionId: string;
    packageName: string;
    versionName: string;
    versionCode: number;
    changelog: string;
    draftPath: string;
    canonicalPath: string;
    size: number;
    sha256: string;
    supportsMobile: boolean;
    supportsTv: boolean;
    accountRequirement: 'none' | 'optional' | 'required';
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

/**
 * True when an insert lost the unique `(app_id, version_code)` race. Other 409
 * responses (for example a foreign-key violation) must not be treated as a
 * duplicate: no existing draft owns the uploaded object in that case.
 */
function isDuplicateDraft(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === '23505';
}

export async function finalizeUpload(
  raw: unknown,
  dependencies: UploadActionDependencies,
): Promise<ActionResult<Readonly<{ id: string; status: 'draft' }>>> {
  let cleanup: CleanupTarget | null = null;
  try {
    const actor = await dependencies.authorize();
    const parsed = finalizeUploadSchema.safeParse(raw);
    if (!parsed.success) throw new ActionException('VALIDATION');
    const input = parsed.data;
    if (input.source !== 'storage') throw new ActionException('VALIDATION');
    const draftPath = `operations/${input.operationId}/source.apk`;
    // Only a schema-valid finalize may touch storage. A rejected payload names
    // an operation id that could belong to another in-flight upload.
    cleanup = { path: draftPath };

    if (!(await dependencies.appExists(input.appId))) throw new ActionException('NOT_FOUND');
    const object = await dependencies.inspectObject(draftPath);
    if (
      !object ||
      object.size !== input.size ||
      object.size > HOSTED_STORAGE_MAX_BYTES ||
      !APK_MIME_TYPES.includes(object.mimeType as (typeof APK_MIME_TYPES)[number])
    ) {
      throw new ActionException('VALIDATION');
    }

    // Trust only bytes read back from storage: parse the real manifest and
    // recompute the digest, then compare with what the client declared.
    const verified = await dependencies.verifyApk(draftPath, object.size);
    assertDeclaredApkMatches(verified, input);

    const versionId = dependencies.createId();
    const canonicalPath = `apps/${input.appId}/versions/${versionId}.apk`;
    const created = await dependencies.createDraft({
      actorId: actor.userId,
      appId: input.appId,
      versionId,
      packageName: verified.manifest.packageName,
      versionName: verified.manifest.versionName,
      versionCode: verified.manifest.versionCode,
      changelog: input.changelog,
      draftPath,
      canonicalPath,
      size: object.size,
      sha256: verified.sha256,
      supportsMobile: input.supportsMobile,
      supportsTv: input.supportsTv,
      accountRequirement: input.accountRequirement,
    });
    if (created.error) {
      // A duplicate key means a draft for this version already exists. It may
      // be the row a replayed finalize created, and publishing still needs the
      // object under this operation path, so this conflict must not delete it.
      if (isDuplicateDraft(created.error)) cleanup = null;
      throw created.error;
    }
    if (!created.data) throw new ActionException('INTERNAL');

    // The draft row exists and publishing needs its storage object, so an
    // audit failure below must keep the object instead of cleaning it up.
    cleanup = null;

    const audit = await dependencies.recordAudit({
      actorId: actor.userId,
      action: 'version.draft',
      targetType: 'version',
      targetId: created.data.id,
      metadata: {
        path: draftPath,
        version_code: verified.manifest.versionCode,
        supports_mobile: input.supportsMobile,
        supports_tv: input.supportsTv,
        account_requirement: input.accountRequirement,
      },
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    return { ok: true, data: { id: created.data.id, status: 'draft' } };
  } catch (error) {
    if (cleanup) {
      try {
        await dependencies.cleanupDraft(cleanup.path);
      } catch {
        // Best effort: never mask the original finalize error.
      }
    }
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
    async verifyApk(path, size) {
      await authorize();
      const env = getServerEnv();
      return verifyApkBytes(createStorageApkSource({
        supabaseUrl: env.supabaseUrl,
        secretKey: env.supabaseSecretKey,
        path,
        size,
      }));
    },
    async cleanupDraft(path) {
      try {
        const target = managedTarget('apk-drafts', path, 'apk_draft');
        if (!target) return;
        const db = await database();
        await enqueueCleanupAssets(
          [{
            bucket: 'apk-drafts',
            path: target.path,
            assetId: target.assetId,
            targetType: 'apk_draft',
          }],
          {
            async enqueue(asset) {
              return enqueueCleanupAndAudit(db, {
                actorId: (await authorize()).userId,
                asset,
                auditAction: 'asset.cleanup_pending',
              });
            },
          },
        );
      } catch {
        // Cleanup is best effort and must never mask the finalize error.
      }
    },
    async createDraft(input) {
      const db = await database();
      return db.from('app_versions').insert({
        id: input.versionId,
        app_id: input.appId,
        package_name: input.packageName,
        version_name: input.versionName,
        version_code: input.versionCode,
        changelog: input.changelog,
        apk_path: input.canonicalPath,
        apk_size_bytes: input.size,
        sha256: input.sha256,
        supports_mobile: input.supportsMobile,
        supports_tv: input.supportsTv,
        account_requirement: input.accountRequirement,
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
  const env = getServerEnv();
  return {
    ...result,
    data: {
      ...result.data,
      endpoint: resumableUploadEndpoint(env.supabaseUrl),
      publishableKey: env.supabasePublishableKey,
    },
  };
}

export async function finalizeUploadAction(raw: z.input<typeof finalizeUploadSchema>) {
  return finalizeUpload(raw, defaultDependencies());
}
