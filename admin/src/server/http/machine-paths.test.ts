import { describe, expect, it } from 'vitest';

import { isBearerAuthenticatedPath } from './machine-paths';

describe('isBearerAuthenticatedPath', () => {
  it('matches exactly the two machine routes', () => {
    expect(isBearerAuthenticatedPath('/api/cleanup/run')).toBe(true);
    expect(isBearerAuthenticatedPath('/api/cleanup/sweep')).toBe(true);
  });

  it('does not match near-miss or nested paths', () => {
    expect(isBearerAuthenticatedPath('/api/cleanup')).toBe(false);
    expect(isBearerAuthenticatedPath('/api/cleanup/run/extra')).toBe(false);
    expect(isBearerAuthenticatedPath('/api/cleanup/run/')).toBe(false);
    expect(isBearerAuthenticatedPath('/api/cleanup/runs')).toBe(false);
    expect(isBearerAuthenticatedPath('/api/uploads/sign')).toBe(false);
    expect(isBearerAuthenticatedPath('/apps')).toBe(false);
    expect(isBearerAuthenticatedPath('/login')).toBe(false);
  });
});
