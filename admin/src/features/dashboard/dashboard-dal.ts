import 'server-only';

import { getAdminClient } from '../../server/supabase/admin-client';
import { requireAdmin } from '../../server/auth/require-admin';
import { ActionException } from '../../server/errors/action-error';
import {
  type DashboardPriority,
  mergeDashboardPriorities,
} from './dashboard-priorities';

export type DashboardSummary = Readonly<{
  openReportCount: number;
  hiddenReviewCount: number;
  suspendedUserCount: number;
  draftVersionCount: number;
  priorities: readonly DashboardPriority[];
}>;

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);

  const [reports, reviews, users, versions, openReports, incompleteOperations] = await Promise.all([
    client.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    client.from('reviews').select('*', { count: 'exact', head: true }).eq('moderation_status', 'hidden'),
    client.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'suspended'),
    client.from('app_versions').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    client
      .from('reports')
      .select('id, reason, description, created_at, apps(title)')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(10),
    client
      .from('admin_audit_logs')
      .select('id, action, target_type, target_id, created_at')
      .contains('metadata', { partial: true })
      .order('created_at', { ascending: true })
      .limit(10),
  ]);

  const firstError = [
    reports.error,
    reviews.error,
    users.error,
    versions.error,
    openReports.error,
    incompleteOperations.error,
  ].find(Boolean);
  if (firstError) throw new ActionException('TEMPORARY');

  return {
    openReportCount: reports.count ?? 0,
    hiddenReviewCount: reviews.count ?? 0,
    suspendedUserCount: users.count ?? 0,
    draftVersionCount: versions.count ?? 0,
    priorities: mergeDashboardPriorities(openReports.data ?? [], incompleteOperations.data ?? []),
  };
}
