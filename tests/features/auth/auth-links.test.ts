import type { SupabaseClient } from '@supabase/supabase-js';

import { handleAuthCallback } from '../../../src/features/auth/auth-links';
import type { Database } from '../../../src/types/database.types';

type AuthClient = SupabaseClient<Database>;

function createClient() {
  const exchangeCodeForSession = jest.fn().mockResolvedValue({ data: {}, error: null });
  const setSession = jest.fn().mockResolvedValue({ data: {}, error: null });

  return {
    client: { auth: { exchangeCodeForSession, setSession } } as unknown as AuthClient,
    exchangeCodeForSession,
    setSession,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error('İşlemin hata vermesi bekleniyordu.');
}

describe('handleAuthCallback', () => {
  it('exchanges a PKCE code only for the exact confirmation target', async () => {
    const { client, exchangeCodeForSession, setSession } = createClient();

    await expect(
      handleAuthCallback('cepdepo://auth/confirm?code=confirmation-code', client),
    ).resolves.toBe('confirmed');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('confirmation-code');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('returns recovery after exchanging an exact reset-password callback', async () => {
    const { client, exchangeCodeForSession } = createClient();

    await expect(
      handleAuthCallback('cepdepo://auth/reset-password?code=recovery-code', client),
    ).resolves.toBe('recovery');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
  });

  it('sets a legacy token session from a callback fragment', async () => {
    const { client, exchangeCodeForSession, setSession } = createClient();

    await expect(
      handleAuthCallback(
        'cepdepo://auth/confirm#access_token=access-value&refresh_token=refresh-value',
        client,
      ),
    ).resolves.toBe('confirmed');
    expect(setSession).toHaveBeenCalledWith({
      access_token: 'access-value',
      refresh_token: 'refresh-value',
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it.each([
    'https://auth/confirm?code=value',
    'cepdepo://other/confirm?code=value',
    'cepdepo://auth/other?code=value',
    'not a url',
  ])('ignores unrelated or malformed URL %s', async url => {
    const { client, exchangeCodeForSession, setSession } = createClient();

    await expect(handleAuthCallback(url, client)).resolves.toBe('ignored');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('rejects an auth target that has no usable credentials', async () => {
    const { client } = createClient();

    await expect(handleAuthCallback('cepdepo://auth/confirm', client)).rejects.toThrow(
      'Kimlik doğrulama bağlantısı geçersiz veya süresi dolmuş.',
    );
  });

  it('redacts callback error parameters', async () => {
    const { client } = createClient();
    const url =
      'cepdepo://auth/confirm?error=access_denied&error_description=secret-provider-detail';

    const error = await rejectionOf(handleAuthCallback(url, client));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Kimlik doğrulama bağlantısı geçersiz veya süresi dolmuş.');
    expect(error.message).not.toContain('secret-provider-detail');
    expect(error.message).not.toContain(url);
  });

  it('redacts expired or reused PKCE errors from Supabase', async () => {
    const { client, exchangeCodeForSession } = createClient();
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('code already used: sensitive-code'),
    });

    const error = await rejectionOf(
      handleAuthCallback('cepdepo://auth/reset-password?code=sensitive-code', client),
    );

    expect(error.message).toBe('Kimlik doğrulama bağlantısı geçersiz veya süresi dolmuş.');
    expect(error.message).not.toContain('sensitive-code');
    expect(error.message).not.toContain('already used');
  });
});
