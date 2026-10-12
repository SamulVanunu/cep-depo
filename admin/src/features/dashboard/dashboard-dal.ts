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
  latestPublishedApps: readonly Readonly<{
    appId: string;
    title: string;
    versionName: string;
    versionCode: number;
    publishedAt: string;
  }>[];
}>;

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);

  const [reports, reviews, users, versions, openReports, incompleteOperations, latestPublished] = await Promise.all([
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
    client
      .from('app_versions')
      .select('app_id, version_name, version_code, published_at, apps(id, title)')
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(5),
  ]);

  const firstError = [
    reports.error,
    reviews.error,
    users.error,
    versions.error,
    openReports.error,
    incompleteOperations.error,
    latestPublished.error,
  ].find(Boolean);
  if (firstError) throw new ActionException('TEMPORARY');

  return {
    openReportCount: reports.count ?? 0,
    hiddenReviewCount: reviews.count ?? 0,
    suspendedUserCount: users.count ?? 0,
    draftVersionCount: versions.count ?? 0,
    priorities: mergeDashboardPriorities(openReports.data ?? [], incompleteOperations.data ?? []),
    latestPublishedApps: (latestPublished.data ?? []).flatMap(version => {
      const app = version.apps;
      if (!app || !version.published_at) return [];
      return [{
        appId: app.id,
        title: app.title,
        versionName: version.version_name,
        versionCode: version.version_code,
        publishedAt: version.published_at,
      }];
    }),
  };
}
