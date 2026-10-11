import 'server-only';

import { notFound } from 'next/navigation';

import { requireAdmin } from '../../server/auth/require-admin';
import { ActionException } from '../../server/errors/action-error';
import { getAdminClient } from '../../server/supabase/admin-client';
import { normalizeUserSearch, userIdSchema } from './user-schema';
import { authBanIsActive, mapManagedUsers, userConsistency } from './user-mapper';

export async function listManagedUsers(input: Readonly<{ page: number; perPage: number; search?: string }>) {
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  const auth = await client.auth.admin.listUsers({ page: input.page, perPage: input.perPage });
  if (auth.error) throw new ActionException('TEMPORARY');
  const search = normalizeUserSearch(input.search);
  const users = search
    ? auth.data.users.filter(user => user.email?.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')))
    : auth.data.users;
  const ids = users.map(user => user.id);
  if (!ids.length) return { items: [], total: auth.data.total, page: input.page, pageSize: input.perPage };
  const [profiles, roles, reviews, reports] = await Promise.all([
    client.from('profiles').select('user_id, username, avatar_path, status, created_at').in('user_id', ids),
    client.from('user_roles').select('user_id, role').in('user_id', ids),
    client.from('reviews').select('user_id').in('user_id', ids),
    client.from('reports').select('reporter_id').in('reporter_id', ids),
  ]);
  if (profiles.error || roles.error || reviews.error || reports.error) throw new ActionException('TEMPORARY');
  return {
    items: mapManagedUsers(users, profiles.data ?? [], roles.data ?? [], reviews.data ?? [], reports.data ?? []),
    total: auth.data.total,
    page: input.page,
    pageSize: input.perPage,
  };
}

export async function getManagedUser(userId: string) {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) notFound();
  const identity = await requireAdmin();
  const client = getAdminClient(identity);
  const [auth, profile, role, reviews, reports] = await Promise.all([
    client.auth.admin.getUserById(parsed.data),
    client.from('profiles').select('user_id, username, avatar_path, status, created_at, updated_at').eq('user_id', parsed.data).maybeSingle(),
    client.from('user_roles').select('role').eq('user_id', parsed.data),
    client.from('reviews').select('*', { count: 'exact', head: true }).eq('user_id', parsed.data),
    client.from('reports').select('*', { count: 'exact', head: true }).eq('reporter_id', parsed.data),
  ]);
  if (auth.error || profile.error || role.error || reviews.error || reports.error) throw new ActionException('TEMPORARY');
  if (!auth.data.user || !profile.data) notFound();
  const banned = authBanIsActive(auth.data.user.banned_until);
  return {
    id: auth.data.user.id,
    email: auth.data.user.email ?? '',
    emailConfirmedAt: auth.data.user.email_confirmed_at ?? null,
    createdAt: auth.data.user.created_at,
    lastSignInAt: auth.data.user.last_sign_in_at ?? null,
    username: profile.data.username,
    avatarPath: profile.data.avatar_path,
    status: profile.data.status,
    banned,
    isAdmin: (role.data ?? []).some(item => item.role === 'admin'),
    reviewCount: reviews.count ?? 0,
    reportCount: reports.count ?? 0,
    consistency: userConsistency(profile.data.status, banned),
  };
}
