import { getPublicEnv } from '../../src/lib/env';

const validEnv = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
};

describe('getPublicEnv', () => {
  it('returns a valid https Supabase URL and publishable key', () => {
    expect(getPublicEnv(validEnv)).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'sb_publishable_example',
    });
  });

  it.each([
    {},
    { EXPO_PUBLIC_SUPABASE_URL: 'not-a-url' },
    {
      EXPO_PUBLIC_SUPABASE_URL: 'http://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    },
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '   ',
    },
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_must_never_ship',
    },
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.service-role-jwt',
    },
  ])('rejects missing or malformed public configuration', (source: Record<string, string | undefined>) => {
    expect(() => getPublicEnv(source)).toThrow(
      'Supabase yapılandırması eksik veya geçersiz.',
    );
  });
});
