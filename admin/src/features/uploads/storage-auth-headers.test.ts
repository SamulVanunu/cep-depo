import { describe, expect, it } from 'vitest';

import { storageAuthHeaders } from './storage-auth-headers';

describe('storageAuthHeaders', () => {
  it('sends new Supabase secret keys through the apikey header', () => {
    expect(storageAuthHeaders('sb_secret_example')).toEqual({ apikey: 'sb_secret_example' });
  });

  it('keeps legacy service-role JWTs in the bearer header for local Supabase', () => {
    expect(storageAuthHeaders('legacy.jwt.value')).toEqual({
      Authorization: 'Bearer legacy.jwt.value',
    });
  });
});
