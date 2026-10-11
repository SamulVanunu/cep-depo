'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getServerEnv } from '../../lib/env';
import { requireAdmin } from '../../server/auth/require-admin';
import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { deleteUserSchema, userIdSchema } from './user-schema';
import type { Json } from '../../types/database.types';

type Actor = Readonly<{ userId: string }>;
type Target = Readonly<{
  userId: string;
  username: string;
  status: 'active' | 'suspended';
  isAdmin: boolean;
  avatarPath: string | null;
  email: string;
}>;

export type UserActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  getTarget(userId: string): Promise<Target | null>;
  countAdmins(): Promise<number>;
  updateAuthBan(userId: string, banned: boolean): Promise<{ error: unknown | null }>;
  setProfileStatus(actorId: string, userId: string, status: 'active' | 'suspended'): Promise<{ error: unknown | null }>;
  deleteAuthUser(userId: string): Promise<{ error: unknown | null }>;
  removeAvatar(path: string): Promise<void>;
  requestRecovery(email: string): Promise<{ error: unknown | null }>;
  recordAudit(input: Readonly<{ actorId: string; action: string; targetId: string; metadata?: Record<string, unknown> }>): Promise<{ error: unknown | null }>;
  emailEnabled: boolean;
  revalidate?(path: string): void;
}>;

function defaultDependencies(): UserActionDependencies {
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
    async getTarget(userId) {
      const db = await database();
      const [profile, role, auth] = await Promise.all([
        db.from('profiles').select('user_id, username, status, avatar_path').eq('user_id', userId).maybeSingle(),
        db.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle(),
        db.auth.admin.getUserById(userId),
      ]);
      if (profile.error || role.error || auth.error) throw profile.error ?? role.error ?? auth.error;
      if (!profile.data || !auth.data.user?.email) return null;
      return {
        userId,
        username: profile.data.username,
        status: profile.data.status,
        isAdmin: Boolean(role.data),
        avatarPath: profile.data.avatar_path,
        email: auth.data.user.email,
      };
    },
    async countAdmins() {
      const result = await (await database()).from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'admin');
      if (result.error) throw result.error;
      return result.count ?? 0;
    },
    async updateAuthBan(userId, banned) {
      return (await database()).auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' });
    },
    async setProfileStatus(actorId, userId, status) {
      return (await database()).rpc('admin_set_profile_status', { p_actor_id: actorId, p_user_id: userId, p_status: status });
    },
    async deleteAuthUser(userId) {
      return (await database()).auth.admin.deleteUser(userId, false);
    },
    async removeAvatar(path) {
      await (await database()).storage.from('avatars').remove([path]);
    },
    async requestRecovery(email) {
      return (await database()).auth.resetPasswordForEmail(email, { redirectTo: 'cepdepo://auth/reset-password' });
    },
    async recordAudit(input) {
      const db = await database();
      if (input.metadata?.partial) {
        return db.from('admin_audit_logs').insert({
          actor_id: input.actorId,
          action: input.action,
          target_type: 'user',
          target_id: input.targetId,
          metadata: input.metadata as NonNullable<Json>,
        });
      }
      return db.rpc('admin_record_external_action', {
        p_actor_id: input.actorId,
        p_action: input.action,
        p_target_type: 'user',
        p_target_id: input.targetId,
        p_metadata: (input.metadata ?? {}) as Json,
      });
    },
    emailEnabled: getServerEnv().authEmailEnabled,
    revalidate: revalidatePath,
  };
}

async function transitionUser(
  userId: string,
  status: 'active' | 'suspended',
  dependencies: UserActionDependencies,
): Promise<ActionResult<null>> {
  try {
    const actor = await dependencies.authorize();
    const id = userIdSchema.parse(userId);
    if (id === actor.userId) throw new ActionException('FORBIDDEN');
    const target = await dependencies.getTarget(id);
    if (!target) throw new ActionException('NOT_FOUND');
    if (target.isAdmin) {
      await dependencies.countAdmins();
      throw new ActionException('FORBIDDEN');
    }
    const auth = await dependencies.updateAuthBan(id, status === 'suspended');
    if (auth.error) throw auth.error;
    const profile = await dependencies.setProfileStatus(actor.userId, id, status);
    if (profile.error) {
      await dependencies.recordAudit({
        actorId: actor.userId,
        action: status === 'suspended' ? 'user.suspend' : 'user.activate',
        targetId: id,
        metadata: { partial: true, status },
      });
      throw new ActionException('TEMPORARY');
    }
    dependencies.revalidate?.(`/users/${id}`);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}

export async function suspendUser(userId: string, dependencies: UserActionDependencies = defaultDependencies()) {
  return transitionUser(userId, 'suspended', dependencies);
}

export async function activateUser(userId: string, dependencies: UserActionDependencies = defaultDependencies()) {
  return transitionUser(userId, 'active', dependencies);
}

export async function requestRecovery(userId: string, dependencies: UserActionDependencies = defaultDependencies()): Promise<ActionResult<null>> {
  try {
    const actor = await dependencies.authorize();
    const id = userIdSchema.parse(userId);
    if (!dependencies.emailEnabled) throw new ActionException('READ_ONLY');
    const target = await dependencies.getTarget(id);
    if (!target) throw new ActionException('NOT_FOUND');
    const recovery = await dependencies.requestRecovery(target.email);
    if (recovery.error) throw recovery.error;
    const audit = await dependencies.recordAudit({ actorId: actor.userId, action: 'user.recovery_request', targetId: id });
    if (audit.error) throw audit.error;
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}

export async function deleteUser(
  raw: z.input<typeof deleteUserSchema>,
  dependencies: UserActionDependencies = defaultDependencies(),
): Promise<ActionResult<null>> {
  try {
    const actor = await dependencies.authorize();
    const input = deleteUserSchema.parse(raw);
    if (input.userId === actor.userId) throw new ActionException('FORBIDDEN');
    const target = await dependencies.getTarget(input.userId);
    if (!target) throw new ActionException('NOT_FOUND');
    if (target.isAdmin) {
      await dependencies.countAdmins();
      throw new ActionException('FORBIDDEN');
    }
    if (target.status !== 'suspended') throw new ActionException('CONFLICT');
    if (input.confirmation !== target.username) throw new ActionException('VALIDATION');
    const deletion = await dependencies.deleteAuthUser(input.userId);
    if (deletion.error) throw deletion.error;
    if (target.avatarPath) await dependencies.removeAvatar(target.avatarPath).catch(() => undefined);
    const audit = await dependencies.recordAudit({ actorId: actor.userId, action: 'user.delete', targetId: input.userId });
    if (audit.error) throw audit.error;
    dependencies.revalidate?.('/users');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}

export async function suspendUserAction(userId: string) { return suspendUser(userId); }
export async function activateUserAction(userId: string) { return activateUser(userId); }
export async function requestRecoveryAction(userId: string) { return requestRecovery(userId); }
export async function deleteUserAction(raw: z.input<typeof deleteUserSchema>) { return deleteUser(raw); }
