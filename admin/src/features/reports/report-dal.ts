import 'server-only';

import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '../../server/auth/require-admin';
import { ActionException } from '../../server/errors/action-error';
import { getAdminClient } from '../../server/supabase/admin-client';

export async function listReports(input: Readonly<{
  page: number;
  pageSize: number;
  status?: 'open' | 'resolved' | 'dismissed';
  reason?: string;
}>) {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  let query = client.from('reports').select(
    'id, reason, status, created_at, resolved_at, apps(id, title), profiles(user_id, username), app_versions(id, version_name)',
    { count: 'exact' },
  );
  if (input.status) query = query.eq('status', input.status);
  if (input.reason && /^[a-z_]{1,40}$/.test(input.reason)) query = query.eq('reason', input.reason as never);
  const from = (input.page - 1) * input.pageSize;
  const result = await query.order('created_at', { ascending: input.status === 'open' }).range(from, from + input.pageSize - 1);
  if (result.error) throw new ActionException('TEMPORARY');
  return { items: result.data ?? [], count: result.count ?? 0, page: input.page, pageSize: input.pageSize };
}

export async function getReport(reportId: string) {
  const parsed = z.string().uuid().safeParse(reportId);
  if (!parsed.success) notFound();
  const identity = await requireAdmin();
  const result = await getAdminClient(identity).from('reports').select(
    '*, apps(id, title, slug), profiles(user_id, username), app_versions(id, version_name, version_code)',
  ).eq('id', parsed.data).maybeSingle();
  if (result.error) throw new ActionException('TEMPORARY');
  if (!result.data) notFound();
  return result.data;
}
