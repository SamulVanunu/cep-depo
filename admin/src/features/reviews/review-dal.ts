import 'server-only';

import { requireAdmin } from '../../server/auth/require-admin';
import { ActionException } from '../../server/errors/action-error';
import { getAdminClient } from '../../server/supabase/admin-client';

export type ReviewListInput = Readonly<{
  page: number;
  pageSize: number;
  status?: 'visible' | 'hidden';
  rating?: number;
  query?: string;
}>;

export async function listReviews(input: ReviewListInput) {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  let query = client.from('reviews').select(
    'id, rating, body, moderation_status, created_at, apps(id, title), profiles(user_id, username)',
    { count: 'exact' },
  );
  if (input.status) query = query.eq('moderation_status', input.status);
  if (input.rating && input.rating >= 1 && input.rating <= 5) query = query.eq('rating', input.rating);
  if (input.query && input.query.length <= 200 && /^[\p{L}\p{N}\s.-]+$/u.test(input.query)) {
    query = query.ilike('body', `%${input.query}%`);
  }
  const from = (input.page - 1) * input.pageSize;
  const result = await query.order('created_at', { ascending: false }).range(from, from + input.pageSize - 1);
  if (result.error) throw new ActionException('TEMPORARY');
  return { items: result.data ?? [], count: result.count ?? 0, page: input.page, pageSize: input.pageSize };
}
