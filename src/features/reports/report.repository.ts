import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';
import { reportReasonOptions, validateReportDescription } from './report.validation';
import type { Report, ReportDraft, ReportTarget } from './report.types';

type ReportClient = SupabaseClient<Database>;
type ReportRow = Pick<
  Database['public']['Tables']['reports']['Row'],
  'id' | 'reporter_id' | 'app_id' | 'version_id' | 'reason' | 'description' | 'status' | 'created_at'
>;

const REPORT_FIELDS =
  'id, reporter_id, app_id, version_id, reason, description, status, created_at';

export class ReportRepositoryError extends Error {
  readonly code: 'alreadyOpen' | 'unknown';

  constructor(message: string, code: ReportRepositoryError['code']) {
    super(message);
    this.name = 'ReportRepositoryError';
    this.code = code;
  }
}

export type ReportRepository = {
  getOpen(target: ReportTarget, reporterId: string): Promise<Report | null>;
  submitReport(target: ReportTarget, reporterId: string, draft: ReportDraft): Promise<Report>;
};

function mapReport(row: ReportRow): Report {
  return Object.freeze({
    id: row.id,
    reporterId: row.reporter_id,
    appId: row.app_id,
    versionId: row.version_id,
    reason: row.reason,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
  });
}

function unknownError() {
  return new ReportRepositoryError(
    'Şikâyet işlemi tamamlanamadı. Lütfen tekrar deneyin.',
    'unknown',
  );
}

export function createReportRepository(client: ReportClient): ReportRepository {
  return {
    async getOpen(target, reporterId) {
      let query = client
        .from('reports')
        .select(REPORT_FIELDS)
        .eq('reporter_id', reporterId)
        .eq('app_id', target.appId)
        .eq('status', 'open');
      query = target.versionId
        ? query.eq('version_id', target.versionId)
        : query.is('version_id', null);
      const { data, error } = await query.maybeSingle();
      if (error) throw unknownError();
      return data ? mapReport(data as ReportRow) : null;
    },

    async submitReport(target, reporterId, draft) {
      if (!reportReasonOptions.some(option => option.value === draft.reason)) throw unknownError();
      const descriptionError = validateReportDescription(draft.description);
      if (descriptionError) throw new Error(descriptionError);
      const description = draft.description.trim() || null;
      const { data, error } = await client
        .from('reports')
        .insert({
          reporter_id: reporterId,
          app_id: target.appId,
          version_id: target.versionId,
          reason: draft.reason,
          description,
        })
        .select(REPORT_FIELDS)
        .single();
      if (error?.code === '23505') {
        throw new ReportRepositoryError(
          'Bu hedef için açık bir şikâyetin zaten var.',
          'alreadyOpen',
        );
      }
      if (error || !data) throw unknownError();
      return mapReport(data as ReportRow);
    },
  };
}
