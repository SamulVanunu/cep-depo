import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';
import { mapAuthError } from './auth.errors';

const CONFIRM_REDIRECT = 'cepdepo://auth/confirm';
const RESET_PASSWORD_REDIRECT = 'cepdepo://auth/reset-password';

type SignUpInput = Readonly<{
  username: string;
  email: string;
  password: string;
}>;

export type AuthRepository = {
  signUp(input: SignUpInput): Promise<'confirmationRequired'>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  isUsernameAvailable(username: string): Promise<boolean>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createAuthRepository(client: SupabaseClient<Database>): AuthRepository {
  return {
    async signUp(input) {
      const { error } = await client.auth.signUp({
        email: normalizeEmail(input.email),
        password: input.password,
        options: {
          data: { username: input.username.trim() },
          emailRedirectTo: CONFIRM_REDIRECT,
        },
      });
      if (error) throw mapAuthError(error, 'username');
      return 'confirmationRequired';
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
      if (error) throw mapAuthError(error);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw mapAuthError(error);
    },

    async resendConfirmation(email) {
      const { error } = await client.auth.resend({
        type: 'signup',
        email: normalizeEmail(email),
        options: { emailRedirectTo: CONFIRM_REDIRECT },
      });
      if (error) throw mapAuthError(error, 'email');
    },

    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: RESET_PASSWORD_REDIRECT,
      });
      if (error) throw mapAuthError(error, 'email');
    },

    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw mapAuthError(error, 'password');
    },

    async isUsernameAvailable(username) {
      const { data, error } = await client
        .from('profiles')
        .select('user_id')
        .eq('username', username.trim())
        .maybeSingle();
      if (error) throw mapAuthError(error, 'username');
      return data === null;
    },
  };
}
