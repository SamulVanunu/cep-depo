'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '../../server/auth/require-admin';
import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { closeReportSchema } from './report-schema';

type Actor = Readonly<{ userId: string }>;
type ReportStatus = 'open' | 'resolved' | 'dismissed';
type CloseInput = z.input<typeof closeReportSchema>;

export type ReportActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  getStatus(reportId: string): Promise<ReportStatus | null>;
  closeRpc(actorId: string, reportId: string, status: 'resolved' | 'dismissed', note: string): Promise<{ error: unknown | null }>;
  revalidate?(path: string): void;
}>;

function defaultDependencies(): ReportActionDependencies {
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
    async getStatus(reportId) {
      const result = await (await database()).from('reports').select('status').eq('id', reportId).maybeSingle();
      if (result.error) throw result.error;
      return result.data?.status ?? null;
    },
    async closeRpc(actorId, reportId, status, note) {
      return (await database()).rpc('admin_close_report', {
        p_actor_id: actorId,
        p_report_id: reportId,
        p_status: status,
        p_admin_note: note,
      });
    },
    revalidate: revalidatePath,
  };
}

export async function closeReport(
  raw: CloseInput,
  dependencies: ReportActionDependencies = defaultDependencies(),
): Promise<ActionResult<null>> {
  try {
    const actor = await dependencies.authorize();
    const input = closeReportSchema.parse(raw);
    if ((await dependencies.getStatus(input.reportId)) !== 'open') throw new ActionException('CONFLICT');
    const result = await dependencies.closeRpc(actor.userId, input.reportId, input.status, input.adminNote);
    if (result.error) throw result.error;
    dependencies.revalidate?.('/reports');
    dependencies.revalidate?.(`/reports/${input.reportId}`);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}

export async function closeReportAction(raw: CloseInput) {
  return closeReport(raw);
}
