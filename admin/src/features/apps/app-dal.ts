import 'server-only';

import { notFound } from 'next/navigation';

import type { ListParams } from '../../lib/search-params';
import { requireAdmin } from '../../server/auth/require-admin';
import { ActionException } from '../../server/errors/action-error';
import { getAdminClient } from '../../server/supabase/admin-client';

export type CategoryOption = Readonly<{
  id: string;
  name: string;
  slug: string;
  position: number;
  isActive: boolean;
}>;

export async function listCategories(): Promise<readonly CategoryOption[]> {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  const { data, error } = await client
    .from('categories')
    .select('id, name, slug, position, is_active')
    .order('position')
    .order('name');
  if (error) throw new ActionException('TEMPORARY');
  return (data ?? []).map(category => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    position: category.position,
    isActive: category.is_active,
  }));
}

export async function listApps(params: ListParams) {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;
  let query = client
    .from('apps')
    .select('id, title, slug, status, featured, download_count, updated_at, categories(id, name)', {
      count: 'exact',
    });

  if (params.query) {
    query = query.or(`title.ilike.%${params.query}%,slug.ilike.%${params.query}%`);
  }
  if (params.status) query = query.eq('status', params.status);
  if (params.categoryId) query = query.eq('category_id', params.categoryId);

  const { data, error, count } = await query
    .order(params.sort, { ascending: params.direction === 'asc' })
    .range(from, to);
  if (error) throw new ActionException('TEMPORARY');

  return {
    items: data ?? [],
    count: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function getApp(appId: string) {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  const { data, error } = await client
    .from('apps')
    .select('*, categories(id, name), app_screenshots(*), app_versions(*)')
    .eq('id', appId)
    .maybeSingle();
  if (error) throw new ActionException('TEMPORARY');
  if (!data) notFound();
  return data;
}
