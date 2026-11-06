/**
 * A10.36 S2 — canonical JSON + SHA-256 for catalog publish payloads.
 *
 * The publish intent records one digest for the payload it sealed, so retries
 * can prove they are carrying the same bytes. That only works if the same
 * logical payload always produces the same byte sequence, which is what this
 * module guarantees:
 *
 *   * object keys are sorted by UTF-16 code unit (locale-independent),
 *   * array order is preserved verbatim — arrays are data, not sets,
 *   * only JSON values are accepted; `undefined`, `NaN`, `±Infinity`, `BigInt`,
 *     functions, symbols, class instances and sparse arrays are rejected
 *     instead of being silently coerced,
 *   * `Date` is the single normalized date form and always serializes as
 *     ISO-8601 UTC with milliseconds, matching `generatedAt` in the documents,
 *   * serialization is UTF-8, hashing is SHA-256, output is lowercase hex.
 *
 * Serialization and hashing are separate functions on purpose: the digest is
 * never computed over an implicit string conversion.
 */

import { createHash } from 'node:crypto';

export type PayloadDigestErrorCode =
  | 'UNDEFINED_VALUE'
  | 'NON_FINITE_NUMBER'
  | 'UNSUPPORTED_TYPE'
  | 'INVALID_DATE'
  | 'CIRCULAR_REFERENCE';

/** A payload that cannot be serialized deterministically. */
export class PayloadDigestError extends Error {
  readonly code: PayloadDigestErrorCode;

  constructor(code: PayloadDigestErrorCode, message: string) {
    super(message);
    this.name = 'PayloadDigestError';
    this.code = code;
  }
}

function jsonString(value: string): string {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string') {
    throw new PayloadDigestError('UNSUPPORTED_TYPE', 'Metin serileştirilemedi.');
  }
  return encoded;
}

function encode(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new PayloadDigestError(
          'NON_FINITE_NUMBER',
          'Sonlu olmayan sayı deterministik serileştirilemez.',
        );
      }
      // `String` matches JSON.stringify for every finite number, including -0.
      return String(value);
    case 'string':
      return jsonString(value);
    case 'undefined':
      throw new PayloadDigestError('UNDEFINED_VALUE', 'undefined değeri kabul edilmez.');
    case 'bigint':
      throw new PayloadDigestError('UNSUPPORTED_TYPE', 'BigInt değeri kabul edilmez.');
    case 'function':
      throw new PayloadDigestError('UNSUPPORTED_TYPE', 'Fonksiyon değeri kabul edilmez.');
    case 'symbol':
      throw new PayloadDigestError('UNSUPPORTED_TYPE', 'Symbol değeri kabul edilmez.');
    default:
      break;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new PayloadDigestError('INVALID_DATE', 'Geçersiz tarih kabul edilmez.');
    }
    return jsonString(value.toISOString());
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new PayloadDigestError(
        'CIRCULAR_REFERENCE',
        'Döngüsel referans serileştirilemez.',
      );
    }
    seen.add(value);
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new PayloadDigestError(
          'UNDEFINED_VALUE',
          'Seyrek diziler (boşluklu) kabul edilmez.',
        );
      }
      items.push(encode(value[index], seen));
    }
    seen.delete(value);
    return `[${items.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PayloadDigestError(
      'UNSUPPORTED_TYPE',
      'Yalnızca düz nesneler serileştirilebilir.',
    );
  }
  if (seen.has(value)) {
    throw new PayloadDigestError(
      'CIRCULAR_REFERENCE',
      'Döngüsel referans serileştirilemez.',
    );
  }
  seen.add(value);
  const record = value as Readonly<Record<string, unknown>>;
  const members = Object.keys(record)
    .sort()
    .map(key => `${jsonString(key)}:${encode(record[key], seen)}`);
  seen.delete(value);
  return `{${members.join(',')}}`;
}

/**
 * Canonical JSON for a catalog payload: no whitespace, sorted object keys,
 * preserved array order, UTF-8-safe string escaping. Throws
 * `PayloadDigestError` for anything JSON cannot represent deterministically.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set<object>());
}

/** SHA-256 of the given bytes as lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * SHA-256 over the UTF-8 bytes of the canonical JSON form. This is the digest
 * the publish intent seals; it never hashes a non-canonical string.
 */
export function computePayloadDigest(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}
