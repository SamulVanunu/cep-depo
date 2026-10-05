import { z } from 'zod';

import { getServerEnv } from '../../lib/env';
import { ActionException } from '../errors/action-error';

const adminIdentityBrand = Symbol('AdminIdentity');
const uuidSchema = z.string().uuid();

export type AdminIdentity = Readonly<{
  userId: string;
  [adminIdentityBrand]: true;
}>;

export type AdminRoleResult = Readonly<{
  data: Readonly<{ userId: string; role: 'admin' }> | null;
  error: unknown | null;
}>;

export type AdminAuthorizationDependencies = Readonly<{
  getVerifiedSubject(): Promise<string | null>;
  getAdminRole(userId: string): Promise<AdminRoleResult>;
  readOnly: boolean;
}>;

export type RequireAdminOptions = Readonly<{
  mutation?: boolean;
}>;

function createIdentity(userId: string): AdminIdentity {
  const identity = { userId } as AdminIdentity;
  Object.defineProperty(identity, adminIdentityBrand, { value: true });
  return Object.freeze(identity);
}

export function isAdminIdentity(value: unknown): value is AdminIdentity {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<AdminIdentity>)[adminIdentityBrand] === true,
  );
}

async function createDefaultDependencies(): Promise<AdminAuthorizationDependencies> {
  const [{ createServerSupabaseClient }, env] = await Promise.all([
    import('../../lib/supabase/server'),
    Promise.resolve(getServerEnv()),
  ]);
  const client = await createServerSupabaseClient();

  return {
    async getVerifiedSubject() {
      const { data, error } = await client.auth.getClaims();
      if (error) return null;
      return typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
    },
    async getAdminRole(userId) {
      const { data, error } = await client
        .from('user_roles')
        .select('user_id, role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();

      return {
        data: data ? { userId: data.user_id, role: data.role } : null,
        error,
      };
    },
    readOnly: env.adminReadOnly,
  };
}

export async function requireAdmin(
  dependencies?: AdminAuthorizationDependencies,
  options: RequireAdminOptions = {},
): Promise<AdminIdentity> {
  const deps = dependencies ?? (await createDefaultDependencies());
  const subject = await deps.getVerifiedSubject();
  const parsedSubject = uuidSchema.safeParse(subject);

  if (!parsedSubject.success) throw new ActionException('UNAUTHENTICATED');

  const roleResult = await deps.getAdminRole(parsedSubject.data);
  if (roleResult.error) throw new ActionException('TEMPORARY');
  if (
    roleResult.data?.role !== 'admin' ||
    roleResult.data.userId !== parsedSubject.data
  ) {
    throw new ActionException('FORBIDDEN');
  }

  if (options.mutation && deps.readOnly) throw new ActionException('READ_ONLY');

  return createIdentity(parsedSubject.data);
}
