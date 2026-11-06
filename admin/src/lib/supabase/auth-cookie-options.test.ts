import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { authCookieOptions } from './auth-cookie-options';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authCookieOptions', () => {
  it('marks the session cookie httpOnly and Secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const options = authCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
  });

  it('keeps Secure off for the local HTTP development server', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(authCookieOptions().secure).toBe(false);
  });

  it('states sameSite and path explicitly instead of relying on library defaults', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const options = authCookieOptions();

    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
  });

  it('caps the cookie at a 30 day inactivity window instead of the 400 day library default', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const options = authCookieOptions();

    expect(options.maxAge).toBe(30 * 24 * 60 * 60);
    expect(options.maxAge).toBeLessThan(400 * 24 * 60 * 60);
  });
});

describe('shared cookie configuration', () => {
  it('feeds both Supabase server clients from the same helper', () => {
    const repoRoot = resolve(import.meta.dirname, '../../..');
    const sources = ['proxy.ts', 'src/lib/supabase/server.ts'].map(file =>
      readFileSync(resolve(repoRoot, file), 'utf8'),
    );

    for (const source of sources) {
      expect(source).toMatch(/cookieOptions:\s*authCookieOptions\(/);
    }
  });
});
