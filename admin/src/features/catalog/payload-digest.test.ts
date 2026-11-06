import { describe, expect, it } from 'vitest';

import {
  PayloadDigestError,
  canonicalJson,
  computePayloadDigest,
  sha256Hex,
} from './payload-digest';

// A10.36 S2 — canonical JSON + SHA-256 contract for catalog publish payloads.
//
// Every expected hex value below was produced independently with:
//   printf '%s' '<canonical json>' | sha256sum
// so the assertions pin real digests rather than "the function did not throw".

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function expectDigestError(run: () => unknown, code: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PayloadDigestError);
  expect((caught as PayloadDigestError).code).toBe(code);
}

describe('canonicalJson', () => {
  it('serializes the same logical payload to the same string every time', () => {
    const first = canonicalJson({ b: 1, a: { d: [true, null], c: 'x' } });
    const second = canonicalJson({ b: 1, a: { d: [true, null], c: 'x' } });

    expect(first).toBe(second);
    expect(first).toBe('{"a":{"c":"x","d":[true,null]},"b":1}');
  });

  it('ignores object key insertion order', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it('preserves array order instead of sorting it', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
  });

  it('sorts keys deterministically at every nesting level', () => {
    const left = canonicalJson({ z: { b: [{ y: 1, x: 2 }], a: null }, m: true });
    const right = canonicalJson({ m: true, z: { a: null, b: [{ x: 2, y: 1 }] } });

    expect(left).toBe(right);
    expect(left).toBe('{"m":true,"z":{"a":null,"b":[{"x":2,"y":1}]}}');
  });

  it('keeps Unicode characters as stable UTF-8 input', () => {
    expect(canonicalJson('Örnek Uygulama ığş')).toBe('"Örnek Uygulama ığş"');
    expect(canonicalJson('emoji 🚀')).toBe('"emoji 🚀"');
  });

  it('distinguishes null from a missing field', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  it('distinguishes a number from its string form', () => {
    expect(canonicalJson({ count: 1 })).toBe('{"count":1}');
    expect(canonicalJson({ count: '1' })).toBe('{"count":"1"}');
  });

  it('distinguishes an empty object from an empty array', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });

  it('normalizes Date instances to one ISO-8601 UTC form', () => {
    expect(canonicalJson(new Date('2026-10-28T12:00:00.000Z'))).toBe(
      '"2026-10-28T12:00:00.000Z"',
    );
    expect(canonicalJson(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
  });

  it('renders negative zero as zero, matching JSON', () => {
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}');
  });

  it('rejects undefined values instead of dropping them', () => {
    expectDigestError(() => canonicalJson(undefined), 'UNDEFINED_VALUE');
    expectDigestError(() => canonicalJson({ a: undefined }), 'UNDEFINED_VALUE');
    expectDigestError(() => canonicalJson([undefined]), 'UNDEFINED_VALUE');
  });

  it('rejects sparse arrays instead of emitting null holes', () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[0] = 1;

    expectDigestError(() => canonicalJson(sparse), 'UNDEFINED_VALUE');
  });

  it('rejects non-finite numbers instead of emitting null', () => {
    expectDigestError(() => canonicalJson(Number.NaN), 'NON_FINITE_NUMBER');
    expectDigestError(() => canonicalJson(Number.POSITIVE_INFINITY), 'NON_FINITE_NUMBER');
    expectDigestError(() => canonicalJson(Number.NEGATIVE_INFINITY), 'NON_FINITE_NUMBER');
    expectDigestError(() => canonicalJson({ n: Number.NaN }), 'NON_FINITE_NUMBER');
  });

  it('rejects BigInt, functions and symbols', () => {
    expectDigestError(() => canonicalJson(BigInt(1)), 'UNSUPPORTED_TYPE');
    expectDigestError(() => canonicalJson({ n: BigInt(1) }), 'UNSUPPORTED_TYPE');
    expectDigestError(() => canonicalJson(() => 1), 'UNSUPPORTED_TYPE');
    expectDigestError(() => canonicalJson(Symbol('x')), 'UNSUPPORTED_TYPE');
  });

  it('rejects class instances that are not plain objects', () => {
    expectDigestError(() => canonicalJson(new Map([['a', 1]])), 'UNSUPPORTED_TYPE');
    expectDigestError(() => canonicalJson(new Set([1])), 'UNSUPPORTED_TYPE');
    expectDigestError(() => canonicalJson(/pattern/u), 'UNSUPPORTED_TYPE');
  });

  it('rejects invalid dates', () => {
    expectDigestError(() => canonicalJson(new Date(Number.NaN)), 'INVALID_DATE');
  });

  it('rejects circular references instead of recursing forever', () => {
    const node: Record<string, unknown> = {};
    node.self = node;

    expectDigestError(() => canonicalJson(node), 'CIRCULAR_REFERENCE');
  });

  it('allows the same object to appear twice without treating it as circular', () => {
    const shared = { a: 1 };

    expect(canonicalJson({ left: shared, right: shared })).toBe(
      '{"left":{"a":1},"right":{"a":1}}',
    );
  });
});

describe('sha256Hex', () => {
  it('matches the published SHA-256 test vector for "abc"', () => {
    expect(sha256Hex(utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('returns lowercase hexadecimal', () => {
    expect(sha256Hex(utf8(''))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computePayloadDigest', () => {
  it('is stable for the same payload', () => {
    const payload = { appCount: 1, apps: [{ app_id: 'a2', title: 'Örnek' }] };

    expect(computePayloadDigest(payload)).toBe(computePayloadDigest({ ...payload }));
  });

  it('hashes the canonical JSON bytes of a string payload', () => {
    expect(computePayloadDigest('abc')).toBe(
      '6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25',
    );
  });

  it('hashes Turkish characters as UTF-8', () => {
    expect(computePayloadDigest('Örnek Uygulama ığş')).toBe(
      '375d31e12bf11c336478589a37b0152bf5df6d93ba932d3d1663c92f059bc7ea',
    );
  });

  it('hashes nested structures deterministically', () => {
    expect(computePayloadDigest({ a: 1, b: { c: [{ d: 2, e: null }], f: true } })).toBe(
      '429ad5c97ff505c2294c5cbd836e1b9634b48d35efdde2c39ef6700436ee83da',
    );
  });

  it('normalizes a Date to the same digest as its ISO string', () => {
    const iso = '2026-10-28T12:00:00.000Z';

    expect(computePayloadDigest(new Date(iso))).toBe(computePayloadDigest(iso));
    expect(computePayloadDigest(new Date(iso))).toBe(
      'e906c052f9b5375bc09793c23e5bbbc33471a777dce9b6f14fdfc9afe6e82b11',
    );
  });

  it('gives different digests to a number and its string form', () => {
    expect(computePayloadDigest({ count: 1 })).toBe(
      '6aea6dfe6561984cdc5c54ead84d47d2cf29e48253ae282aef237404adad4661',
    );
    expect(computePayloadDigest({ count: '1' })).toBe(
      '9206a327f6f770e06b9eff60042ce6537c8db7bae1c5828cdec7675f2c4bae06',
    );
  });

  it('gives different digests to null and a missing field', () => {
    expect(computePayloadDigest({ a: null })).toBe(
      'd091f9c83c091f79652fe8786375b3fe4ce0861a56f5bfbafedbe431877ff0e8',
    );
    expect(computePayloadDigest({})).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
  });

  it('gives different digests to an empty object and an empty array', () => {
    expect(computePayloadDigest([])).toBe(
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    );
    expect(computePayloadDigest([])).not.toBe(computePayloadDigest({}));
  });

  it('gives different digests when array order changes', () => {
    expect(computePayloadDigest(['a', 'b'])).not.toBe(computePayloadDigest(['b', 'a']));
  });

  it('gives the same digest when object key order changes', () => {
    expect(computePayloadDigest({ a: 2, b: 1 })).toBe(
      'd3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772',
    );
    expect(computePayloadDigest({ b: 1, a: 2 })).toBe(
      'd3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772',
    );
  });

  it('rejects invalid payloads before hashing', () => {
    expectDigestError(() => computePayloadDigest({ a: undefined }), 'UNDEFINED_VALUE');
    expectDigestError(() => computePayloadDigest({ a: Number.NaN }), 'NON_FINITE_NUMBER');
  });
});
