'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '../../../src/server/auth/require-admin';
import {
  ActionException,
  type ActionResult,
  toActionError,
} from '../../../src/server/errors/action-error';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

export type LoginDependencies = Readonly<{
  signInWithPassword(credentials: Readonly<{ email: string; password: string }>): Promise<{
    error: unknown | null;
  }>;
  verifyAdmin(): Promise<void>;
  signOut(): Promise<void>;
}>;

export async function authenticateAdmin(
  formData: FormData,
  dependencies?: LoginDependencies,
): Promise<ActionResult<null>> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { ok: false, error: toActionError(new ActionException('VALIDATION')) };
  }

  const client = dependencies
    ? null
    : await import('../../../src/lib/supabase/server').then(module =>
        module.createServerSupabaseClient(),
      );
  const deps: LoginDependencies = dependencies ?? {
    signInWithPassword: credentials => client!.auth.signInWithPassword(credentials),
    async verifyAdmin() {
      await requireAdmin();
    },
    async signOut() {
      await client!.auth.signOut();
    },
  };

  const signIn = await deps.signInWithPassword(parsed.data);
  if (signIn.error) {
    return {
      ok: false,
      error: {
        ...toActionError(new ActionException('UNAUTHENTICATED')),
        message: 'E-posta veya şifre hatalı.',
      },
    };
  }

  try {
    await deps.verifyAdmin();
    return { ok: true, data: null };
  } catch (error) {
    await deps.signOut();
    return { ok: false, error: toActionError(error) };
  }
}

export async function loginAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await authenticateAdmin(formData);
  if (result.ok) redirect('/');
  return result;
}

export async function logoutAction(): Promise<never> {
  const { createServerSupabaseClient } = await import('../../../src/lib/supabase/server');
  const client = await createServerSupabaseClient();
  await client.auth.signOut();
  redirect('/login');
}
