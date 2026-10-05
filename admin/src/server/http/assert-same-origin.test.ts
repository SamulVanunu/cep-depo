import { describe, expect, it } from 'vitest';

import { assertSameOrigin } from './assert-same-origin';

const siteUrl = 'https://admin.cepdepo.example';

function request(method: string, origin?: string): Request {
  return new Request(`${siteUrl}/api/uploads/sign`, {
    method,
    headers: origin ? { origin } : undefined,
  });
}

describe('assertSameOrigin', () => {
  it('accepts an exact same-origin POST', () => {
    expect(() => assertSameOrigin(request('POST', siteUrl), siteUrl)).not.toThrow();
  });

  it('ignores origin checks for non-mutating methods', () => {
    expect(() => assertSameOrigin(request('GET'), siteUrl)).not.toThrow();
  });

  it('rejects a cross-origin POST', () => {
    expect(() => assertSameOrigin(request('POST', 'https://attacker.example'), siteUrl)).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects a POST without an Origin header', () => {
    expect(() => assertSameOrigin(request('POST'), siteUrl)).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects invalid configured or request origins without reflecting them', () => {
    expect(() => assertSameOrigin(request('POST', 'not a url'), 'not a url')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
