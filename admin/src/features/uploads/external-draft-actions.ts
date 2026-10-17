'use server';

import { z } from 'zod';

import type { Json } from '../../types/database.types';
import { requireAdmin } from '../../server/auth/require-admin';
import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { parseExternalApkUrl } from './external-apk';
import { externalDraftInputSchema } from './upload-schema';

type Actor = Readonly<{ userId: string }>;
type MutationError = Readonly<{ code?: string; status?: number }> | null;

const externalDraftSchema = externalDraftInputSchema;

type ExternalDraftInsert = Readonly<{
  actorId: string;
  appId: string;
  versionId: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  changelog: string;
  source: 'external';
  apkUrl: string;
  size: number;
  sha256: string;
}>;

type AuditInput = Readonly<{
  actorId: string;
  action: 'version.draft';
  targetType: 'version';
  targetId: string;
  metadata: Readonly<{
    download_source: 'external';
    hostname: string;
    version_code: number;
  }>;
}>;

export type ExternalDraftActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  appExists(appId: string): Promise<boolean>;
  createId(): string;
  createDraft(input: ExternalDraftInsert): Promise<{
    data: Readonly<{ id: string }> | null;
    error: MutationError;
  }>;
  recordAudit(input: AuditInput): Promise<{ error: MutationError }>;
  externalPublishingEnabled?: boolean;
}>;

function defaultDependencies(): ExternalDraftActionDependencies {
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
    async appExists(appId) {
      const db = await database();
      const result = await db.from('apps').select('id').eq('id', appId).maybeSingle();
      if (result.error) throw result.error;
      return Boolean(result.data);
    },
    createId: () => crypto.randomUUID(),
    async createDraft(input) {
      const db = await database();
      return db.from('app_versions').insert({
        id: input.versionId,
        app_id: input.appId,
        package_name: input.packageName,
        version_name: input.versionName,
        version_code: input.versionCode,
        changelog: input.changelog,
        download_source: input.source,
        apk_path: null,
        apk_url: input.apkUrl,
        apk_size_bytes: input.size,
        sha256: input.sha256,
        status: 'draft',
        created_by: input.actorId,
      }).select('id').single();
    },
    async recordAudit(input) {
      const db = await database();
      return db.rpc('admin_record_external_action', {
        p_actor_id: input.actorId,
        p_action: input.action,
        p_target_type: input.targetType,
        p_target_id: input.targetId,
        p_metadata: input.metadata as Json,
      });
    },
  };
}

export async function createExternalDraft(
  raw: unknown,
  dependencies: ExternalDraftActionDependencies = defaultDependencies(),
): Promise<ActionResult<Readonly<{ id: string; status: 'draft'; hostname: string }>>> {
  try {
    const actor = await dependencies.authorize();
    if (dependencies.externalPublishingEnabled === false) {
      throw new ActionException('FEATURE_DISABLED');
    }
    const rawWithSource = (raw && typeof raw === 'object' && !Array.isArray(raw) && !(raw as Record<string, unknown>).source)
      ? { ...(raw as Record<string, unknown>), source: 'external' }
      : raw;
    const input = externalDraftSchema.parse(rawWithSource);
    const parsedUrl = parseExternalApkUrl(input.apkUrl);
    if (!(await dependencies.appExists(input.appId))) throw new ActionException('NOT_FOUND');
    const versionId = dependencies.createId();
    const created = await dependencies.createDraft({
      actorId: actor.userId,
      appId: input.appId,
      packageName: input.packageName,
      versionId,
      versionName: input.versionName,
      versionCode: input.versionCode,
      changelog: input.changelog,
      source: 'external',
      apkUrl: parsedUrl.url,
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
      metadata: {
        download_source: 'external',
        hostname: parsedUrl.hostname,
        version_code: input.versionCode,
      },
    });
    if (audit.error) throw new ActionException('TEMPORARY');
    return {
      ok: true,
      data: { id: created.data.id, status: 'draft', hostname: parsedUrl.hostname },
    };
  } catch (error) {
    const normalized = error instanceof z.ZodError || (
      error instanceof Error && error.message === 'Geçerli bir herkese açık HTTPS APK bağlantısı gir.'
    )
      ? new ActionException('VALIDATION')
      : error;
    return { ok: false, error: toActionError(normalized) };
  }
}

export async function createExternalDraftAction(raw: unknown) {
  return createExternalDraft(raw);
}
