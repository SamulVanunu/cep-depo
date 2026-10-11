import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy } from './content-security-policy';

describe('contentSecurityPolicy', () => {
  it('allows both hosted Supabase API and direct Storage upload origins', () => {
    const policy = contentSecurityPolicy('nonce', 'https://sample.supabase.co', false);
    expect(policy).toContain(
      "connect-src 'self' https://sample.supabase.co https://sample.storage.supabase.co",
    );
  });

  it('uses only the local gateway origin for local Supabase', () => {
    const policy = contentSecurityPolicy('nonce', 'http://127.0.0.1:56321', true);
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:56321");
    expect(policy).not.toContain('127.storage.supabase.co');
  });
});
