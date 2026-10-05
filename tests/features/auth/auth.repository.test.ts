import type { SupabaseClient } from '@supabase/supabase-js';

import { createAuthRepository } from '../../../src/features/auth/auth.repository';
import type { Database } from '../../../src/types/database.types';

type AuthClient = SupabaseClient<Database>;

function createClient() {
  const signUp = jest.fn().mockResolvedValue({ data: { session: null }, error: null });
  const signInWithPassword = jest.fn().mockResolvedValue({ data: {}, error: null });
  const signOut = jest.fn().mockResolvedValue({ error: null });
  const resend = jest.fn().mockResolvedValue({ data: {}, error: null });
  const resetPasswordForEmail = jest.fn().mockResolvedValue({ data: {}, error: null });
  const updateUser = jest.fn().mockResolvedValue({ data: {}, error: null });
  const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));

  return {
    client: {
      auth: {
        signUp,
        signInWithPassword,
        signOut,
        resend,
        resetPasswordForEmail,
        updateUser,
      },
      from,
    } as unknown as AuthClient,
    signUp,
    signInWithPassword,
    signOut,
    resend,
    resetPasswordForEmail,
    updateUser,
    from,
    select,
    eq,
    maybeSingle,
  };
}

describe('AuthRepository', () => {
  it('signs up with normalized email, preserved username and exact confirmation redirect', async () => {
    const mock = createClient();
    const repository = createAuthRepository(mock.client);

    await expect(
      repository.signUp({ username: '  Çağrı_Öz  ', email: '  USER@Example.COM ', password: '123456' }),
    ).resolves.toBe('confirmationRequired');
    expect(mock.signUp).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: '123456',
      options: {
        data: { username: 'Çağrı_Öz' },
        emailRedirectTo: 'cepdepo://auth/confirm',
      },
    });
  });

  it('maps a duplicate username race without exposing database details', async () => {
    const mock = createClient();
    mock.signUp.mockResolvedValue({
      data: { session: null },
      error: { code: '23505', message: 'profiles_username_key duplicate' },
    });
    const repository = createAuthRepository(mock.client);

    await expect(
      repository.signUp({ username: 'Taken.Name', email: 'user@example.com', password: '123456' }),
    ).rejects.toMatchObject({ field: 'username', message: 'Bu kullanıcı adı kullanılıyor.' });
  });

  it('checks username availability as a read-only advisory query', async () => {
    const mock = createClient();
    const repository = createAuthRepository(mock.client);

    await expect(repository.isUsernameAvailable('  User.Name  ')).resolves.toBe(true);
    expect(mock.from).toHaveBeenCalledWith('profiles');
    expect(mock.select).toHaveBeenCalledWith('user_id');
    expect(mock.eq).toHaveBeenCalledWith('username', 'User.Name');

    mock.maybeSingle.mockResolvedValue({ data: { user_id: 'existing' }, error: null });
    await expect(repository.isUsernameAvailable('User.Name')).resolves.toBe(false);
  });

  it('uses exact redirects for confirmation resend and password reset', async () => {
    const mock = createClient();
    const repository = createAuthRepository(mock.client);

    await repository.resendConfirmation(' USER@example.com ');
    await repository.requestPasswordReset(' USER@example.com ');

    expect(mock.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'user@example.com',
      options: { emailRedirectTo: 'cepdepo://auth/confirm' },
    });
    expect(mock.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: 'cepdepo://auth/reset-password',
    });
  });

  it('keeps password-reset request success identical when no account exists', async () => {
    const mock = createClient();
    mock.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const repository = createAuthRepository(mock.client);

    await expect(repository.requestPasswordReset('missing@example.com')).resolves.toBeUndefined();
  });

  it('delegates sign-in, active-user password update and sign-out once', async () => {
    const mock = createClient();
    const repository = createAuthRepository(mock.client);

    await repository.signIn(' USER@example.com ', 'secret');
    await repository.updatePassword('new-secret');
    await repository.signOut();

    expect(mock.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mock.updateUser).toHaveBeenCalledWith({ password: 'new-secret' });
    expect(mock.signOut).toHaveBeenCalledTimes(1);
  });
});
