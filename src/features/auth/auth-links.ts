import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';

type AuthCallbackResult = 'confirmed' | 'recovery' | 'ignored';

const CALLBACK_ERROR_MESSAGE = 'Kimlik doğrulama bağlantısı geçersiz veya süresi dolmuş.';

function callbackError(): Error {
  return new Error(CALLBACK_ERROR_MESSAGE);
}

function parseCallback(url: string): {
  result: Exclude<AuthCallbackResult, 'ignored'>;
  params: URLSearchParams;
} | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'cepdepo:' || parsed.hostname !== 'auth') return null;

  const result =
    parsed.pathname === '/confirm'
      ? 'confirmed'
      : parsed.pathname === '/reset-password'
        ? 'recovery'
        : null;
  if (!result) return null;

  const params = new URLSearchParams(parsed.search);
  const fragment = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '');
  fragment.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });

  return { result, params };
}

export async function handleAuthCallback(
  url: string,
  client: SupabaseClient<Database>,
): Promise<AuthCallbackResult> {
  const callback = parseCallback(url);
  if (!callback) return 'ignored';

  const { params, result } = callback;
  if (params.has('error') || params.has('error_code') || params.has('error_description')) {
    throw callbackError();
  }

  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  try {
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw callbackError();
      return result;
    }

    if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw callbackError();
      return result;
    }
  } catch {
    throw callbackError();
  }

  throw callbackError();
}
