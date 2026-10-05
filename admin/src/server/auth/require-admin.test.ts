import { describe, expect, it, vi } from 'vitest';

import {
  type AdminAuthorizationDependencies,
  requireAdmin,
} from './require-admin';

const adminId = 'a1000000-0000-4000-8000-000000000001';
const otherId = 'a1000000-0000-4000-8000-000000000002';

function dependencies(
  overrides: Partial<AdminAuthorizationDependencies> = {},
): AdminAuthorizationDependencies {
  return {
    getVerifiedSubject: vi.fn(async () => adminId),
    getAdminRole: vi.fn(async () => ({
      data: { userId: adminId, role: 'admin' as const },
      error: null,
    })),
    readOnly: false,
    ...overrides,
  };
}

describe('requireAdmin', () => {
  it('returns the verified actor id for an admin claim and matching self-role row', async () => {
    await expect(requireAdmin(dependencies())).resolves.toEqual({ userId: adminId });
  });

  it('rejects a signed-out request', async () => {
    await expect(
      requireAdmin(dependencies({ getVerifiedSubject: vi.fn(async () => null) })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a malformed subject before querying roles', async () => {
    const getAdminRole = vi.fn();

    await expect(
      requireAdmin(
        dependencies({
          getVerifiedSubject: vi.fn(async () => 'not-a-uuid'),
          getAdminRole,
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(getAdminRole).not.toHaveBeenCalled();
  });

  it('rejects a non-admin before a privileged continuation can construct a secret client', async () => {
    const createSecretClient = vi.fn();
    const authorization = requireAdmin(
      dependencies({ getAdminRole: vi.fn(async () => ({ data: null, error: null })) }),
    );

    await expect(authorization.then(createSecretClient)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(createSecretClient).not.toHaveBeenCalled();
  });

  it('rejects a role-query failure without treating it as a non-admin result', async () => {
    await expect(
      requireAdmin(
        dependencies({
          getAdminRole: vi.fn(async () => ({ data: null, error: new Error('database detail') })),
        }),
      ),
    ).rejects.toMatchObject({ code: 'TEMPORARY' });
  });

  it('rejects a forged role row belonging to another user', async () => {
    await expect(
      requireAdmin(
        dependencies({
          getAdminRole: vi.fn(async () => ({
            data: { userId: otherId, role: 'admin' as const },
            error: null,
          })),
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects mutations when the environment is read-only', async () => {
    await expect(
      requireAdmin(dependencies({ readOnly: true }), { mutation: true }),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
  });
});
