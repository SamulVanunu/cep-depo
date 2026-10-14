import { describe, expect, it } from 'vitest';

import { getPublicEnv, getServerEnv } from './env';

const validPublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
};

describe('getPublicEnv', () => {
  it('accepts an HTTPS Supabase URL and publishable key', () => {
    expect(getPublicEnv(validPublicEnv)).toEqual({
      supabaseUrl: 'https://project-ref.supabase.co',
      supabasePublishableKey: 'sb_publishable_example',
    });
  });

  it('rejects non-HTTPS Supabase URLs', () => {
    expect(() =>
      getPublicEnv({ ...validPublicEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://project-ref.supabase.co' }),
    ).toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });
});

describe('getServerEnv', () => {
  it('uses deny-by-default feature flags', () => {
    expect(
      getServerEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_SITE_URL: 'https://admin.example.com',
        SUPABASE_SECRET_KEY: 'sb_secret_example',
      }),
    ).toEqual({
      ...getPublicEnv(validPublicEnv),
      siteUrl: 'https://admin.example.com',
      supabaseSecretKey: 'sb_secret_example',
      adminReadOnly: true,
      authEmailEnabled: false,
      externalApkPublishingEnabled: false,
    });
  });

  it('enables external APK publication only for the exact true value', () => {
    const base = {
      ...validPublicEnv,
      NEXT_PUBLIC_SITE_URL: 'https://admin.example.com',
      SUPABASE_SECRET_KEY: 'sb_secret_example',
    };
    expect(getServerEnv({ ...base, EXTERNAL_APK_PUBLISHING_ENABLED: 'true' }).externalApkPublishingEnabled).toBe(true);
    expect(getServerEnv({ ...base, EXTERNAL_APK_PUBLISHING_ENABLED: 'false' }).externalApkPublishingEnabled).toBe(false);
    expect(() => getServerEnv({ ...base, EXTERNAL_APK_PUBLISHING_ENABLED: 'yes' })).toThrow(
      'EXTERNAL_APK_PUBLISHING_ENABLED',
    );
  });

  it('rejects a missing secret without echoing supplied values', () => {
    const secret = 'must-not-appear-in-errors';

    expect(() =>
      getServerEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_SITE_URL: 'https://admin.example.com',
        SUPABASE_SECRET_KEY: '',
        UNUSED_SECRET: secret,
      }),
    ).toThrow('SUPABASE_SECRET_KEY');

    try {
      getServerEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_SITE_URL: 'https://admin.example.com',
        SUPABASE_SECRET_KEY: '',
        UNUSED_SECRET: secret,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
