import { describe, expect, it, vi } from 'vitest';

import { ActionException } from '../../server/errors/action-error';
import { authenticateAdmin, type LoginDependencies } from '../../../app/(auth)/login/actions';

function formData(email = 'admin@example.com', password = 'correct horse battery staple') {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

function dependencies(overrides: Partial<LoginDependencies> = {}): LoginDependencies {
  return {
    signInWithPassword: vi.fn(async () => ({ error: null })),
    verifyAdmin: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('authenticateAdmin', () => {
  it('returns a generic invalid-credentials error without echoing the email', async () => {
    const email = 'private-admin@example.com';
    const result = await authenticateAdmin(
      formData(email, 'wrong-password'),
      dependencies({ signInWithPassword: vi.fn(async () => ({ error: new Error('invalid') })) }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'E-posta veya şifre hatalı.',
      },
    });
    expect(JSON.stringify(result)).not.toContain(email);
    expect(JSON.stringify(result)).not.toContain('wrong-password');
  });

  it('rejects invalid form values before calling Supabase', async () => {
    const signInWithPassword = vi.fn(async () => ({ error: null }));

    await expect(
      authenticateAdmin(formData('not-an-email', 'short'), dependencies({ signInWithPassword })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs out a valid user who does not have the admin role', async () => {
    const signOut = vi.fn(async () => undefined);
    const result = await authenticateAdmin(
      formData(),
      dependencies({
        verifyAdmin: vi.fn(async () => {
          throw new ActionException('FORBIDDEN');
        }),
        signOut,
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('returns success only after role verification', async () => {
    const order: string[] = [];
    const result = await authenticateAdmin(
      formData(),
      dependencies({
        signInWithPassword: vi.fn(async () => {
          order.push('sign-in');
          return { error: null };
        }),
        verifyAdmin: vi.fn(async () => {
          order.push('verify-admin');
        }),
      }),
    );

    expect(result).toEqual({ ok: true, data: null });
    expect(order).toEqual(['sign-in', 'verify-admin']);
  });
});
