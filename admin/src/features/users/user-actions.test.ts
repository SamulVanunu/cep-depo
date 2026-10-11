import { describe, expect, it, vi } from 'vitest';

import {
  deleteUser,
  suspendUser,
  type UserActionDependencies,
} from './user-actions';
import { normalizeUserSearch } from './user-schema';
import { mapManagedUsers } from './user-mapper';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const userId = 'a2000000-0000-4000-8000-000000000001';

function dependencies(overrides: Partial<UserActionDependencies> = {}): UserActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    getTarget: vi.fn(async () => ({
      userId,
      username: 'ornek_kullanici',
      status: 'active' as const,
      isAdmin: false,
      avatarPath: null,
      email: 'private@example.test',
    })),
    countAdmins: vi.fn(async () => 2),
    updateAuthBan: vi.fn(async () => ({ error: null })),
    setProfileStatus: vi.fn(async () => ({ error: null })),
    deleteAuthUser: vi.fn(async () => ({ error: null })),
    removeAvatar: vi.fn(async () => undefined),
    requestRecovery: vi.fn(async () => ({ error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    emailEnabled: true,
    ...overrides,
  };
}

describe('user input boundaries', () => {
  it.each(['%', '_', 'x'.repeat(321)])('normalizes or rejects unsafe user search: %s', value => {
    expect(normalizeUserSearch(value)).toBeUndefined();
  });

  it('joins Auth users to profiles without exposing auth metadata blobs', () => {
    const [user] = mapManagedUsers(
      [{ id: userId, email: 'u@example.test', created_at: '2026-01-01', user_metadata: { secret: 'no' }, app_metadata: { provider: 'email' } }],
      [{ user_id: userId, username: 'user', avatar_path: null, status: 'active', created_at: '2026-01-01' }],
      [], [], [],
    );
    expect(user).toMatchObject({ id: userId, username: 'user', email: 'u@example.test' });
    expect(user).not.toHaveProperty('user_metadata');
    expect(user).not.toHaveProperty('app_metadata');
  });

  it('reports profile/auth suspension mismatch as partial state', () => {
    const [user] = mapManagedUsers(
      [{ id: userId, email: 'u@example.test', created_at: '2026-01-01', banned_until: '2999-01-01' }],
      [{ user_id: userId, username: 'user', avatar_path: null, status: 'active', created_at: '2026-01-01' }],
      [], [], [],
    );
    expect(user.consistency).toBe('partial');
  });
});

describe('destructive user boundaries', () => {
  it('rejects direct self-suspension before Auth admin mutation', async () => {
    const updateAuthBan = vi.fn();
    const result = await suspendUser(actorId, dependencies({ updateAuthBan }));
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(updateAuthBan).not.toHaveBeenCalled();
  });

  it('rejects direct self-deletion before Auth admin mutation', async () => {
    const deleteAuthUser = vi.fn();
    const result = await deleteUser(
      { userId: actorId, confirmation: 'admin_e2e' },
      dependencies({ deleteAuthUser }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it('rejects suspension or deletion of the sole admin', async () => {
    const target = { userId, username: 'sole_admin', status: 'suspended' as const, isAdmin: true, avatarPath: null, email: 'admin@example.test' };
    const deps = dependencies({ getTarget: vi.fn(async () => target), countAdmins: vi.fn(async () => 1) });
    await expect(suspendUser(userId, deps)).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await expect(deleteUser({ userId, confirmation: 'sole_admin' }, deps)).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('requires suspended profile and exact normalized username before hard delete', async () => {
    const deleteAuthUser = vi.fn();
    const active = dependencies({ deleteAuthUser });
    await expect(deleteUser({ userId, confirmation: 'ornek_kullanici' }, active)).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const suspended = dependencies({
      getTarget: vi.fn(async () => ({ userId, username: 'ornek_kullanici', status: 'suspended' as const, isAdmin: false, avatarPath: null, email: 'x@y.z' })),
      deleteAuthUser,
    });
    await expect(deleteUser({ userId, confirmation: 'wrong' }, suspended)).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it('does not report success when Auth ban succeeds but profile transition fails', async () => {
    const result = await suspendUser(userId, dependencies({
      setProfileStatus: vi.fn(async () => ({ error: new Error('db unavailable') })),
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'TEMPORARY' } });
  });
});
