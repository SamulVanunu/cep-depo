import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ kind: 'browser-client' })),
  getPublicEnv: vi.fn(() => ({
    supabaseUrl: 'https://project-ref.supabase.co',
    supabasePublishableKey: 'sb_publishable_example',
  })),
}));

vi.mock('@supabase/ssr', () => ({ createBrowserClient: mocks.createBrowserClient }));
vi.mock('../env', () => ({ getPublicEnv: mocks.getPublicEnv }));

import { createBrowserSupabaseClient } from './browser';

describe('createBrowserSupabaseClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project-ref.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_example');
  });

  it('passes statically addressable public variables into validation for client bundling', () => {
    createBrowserSupabaseClient();

    expect(mocks.getPublicEnv).toHaveBeenCalledWith({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    });
  });
});
