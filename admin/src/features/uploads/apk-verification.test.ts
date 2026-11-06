// @vitest-environment node

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ActionException } from '../../server/errors/action-error';
import type { ApkByteSource } from './apk-manifest';
import {
  APK_HASH_CHUNK_BYTES,
  assertDeclaredApkMatches,
  verifyApkBytes,
  type DeclaredApkIdentity,
} from './apk-verification';
import { createValidApk, buildManifestXml, createApkFromXmlBytes } from './fixtures/manifest-apk';

const TAIL_WINDOW = 128 * 1024;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function memorySource(bytes: Uint8Array): ApkByteSource {
  return {
    size: bytes.length,
    async read(start, endExclusive) {
      return bytes.slice(start, endExclusive);
    },
  };
}

async function apkBytes(
  opts: Parameters<typeof createValidApk>[0] = {},
): Promise<Uint8Array> {
  const blob = await createValidApk(opts);
  return new Uint8Array(await blob.arrayBuffer());
}

const bytes = await apkBytes({
  packageName: 'com.example.app',
  versionName: '1.0.0',
  versionCode: 42,
});
const verifiedFixture = await verifyApkBytes(memorySource(bytes));
const declared: DeclaredApkIdentity = {
  packageName: verifiedFixture.manifest.packageName,
  versionName: verifiedFixture.manifest.versionName,
  versionCode: verifiedFixture.manifest.versionCode,
  sha256: verifiedFixture.sha256,
};

describe('verifyApkBytes', () => {
  it('parses the real fixture and recomputes the SHA-256', async () => {
    expect(verifiedFixture.manifest).toMatchObject({
      packageName: 'com.example.app',
      versionName: '1.0.0',
      versionCode: 42,
    });
    expect(verifiedFixture.sha256).toBe(sha256Hex(bytes));
  });

  it('hashes in bounded chunks and covers the whole file', async () => {
    const blob = await createApkFromXmlBytes(
      buildManifestXml({
        packageName: 'com.example.chunked',
        versionName: '1.0.0',
        versionCode: 2,
      }),
      { padBytes: 5 * 1024 * 1024 },
    );
    const fileBytes = new Uint8Array(await blob.arrayBuffer());
    const reads: number[] = [];
    const source: ApkByteSource = {
      size: fileBytes.length,
      async read(start, endExclusive) {
        const length = endExclusive - start;
        reads.push(length);
        return fileBytes.slice(start, endExclusive);
      },
    };

    const result = await verifyApkBytes(source);

    expect(result.sha256).toBe(sha256Hex(fileBytes));
    expect(Math.max(...reads)).toBeLessThanOrEqual(APK_HASH_CHUNK_BYTES);
    const hashReads = reads.filter(length => length > TAIL_WINDOW);
    expect(hashReads.reduce((sum, length) => sum + length, 0)).toBe(fileBytes.length);
  });

  it('rejects a PK-prefixed non-ZIP file before hashing the whole file', async () => {
    const fake = new Uint8Array(5 * 1024 * 1024);
    fake.set([0x50, 0x4b, 0x03, 0x04], 0);
    const read = vi.fn(async (start: number, endExclusive: number) => fake.slice(start, endExclusive));

    await expect(verifyApkBytes({ size: fake.length, read })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const lengths = read.mock.calls.map(([start, endExclusive]) => endExclusive - start);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(TAIL_WINDOW);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBeLessThan(fake.length);
  });

  it('keeps a transient storage failure during parsing as TEMPORARY', async () => {
    const source: ApkByteSource = {
      size: 5 * 1024 * 1024,
      async read() {
        throw new ActionException('TEMPORARY');
      },
    };

    await expect(verifyApkBytes(source)).rejects.toMatchObject({ code: 'TEMPORARY' });
  });

  it('rejects an empty source as invalid', async () => {
    await expect(verifyApkBytes({ size: 0, read: vi.fn() })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects a short read during hashing with TEMPORARY', async () => {
    const blob = await createApkFromXmlBytes(
      buildManifestXml({
        packageName: 'com.example.short',
        versionName: '1.0.0',
        versionCode: 1,
      }),
      { padBytes: 5 * 1024 * 1024 },
    );
    const fileBytes = new Uint8Array(await blob.arrayBuffer());
    const source: ApkByteSource = {
      size: fileBytes.length,
      async read(start, endExclusive) {
        // Behave for parser windows, truncate the large hash chunk.
        return endExclusive - start > TAIL_WINDOW
          ? fileBytes.slice(start, endExclusive - 1)
          : fileBytes.slice(start, endExclusive);
      },
    };

    await expect(verifyApkBytes(source)).rejects.toMatchObject({ code: 'TEMPORARY' });
  });
});

describe('assertDeclaredApkMatches', () => {
  it('accepts exact declared identity', () => {
    expect(() => assertDeclaredApkMatches(verifiedFixture, declared)).not.toThrow();
  });

  it.each([
    ['packageName', { packageName: 'com.example.other' }],
    ['versionName', { versionName: '9.9.9' }],
    ['versionCode', { versionCode: 43 }],
    ['sha256', { sha256: 'a'.repeat(64) }],
  ] as const)('rejects a mismatched %s', (_, override) => {
    expect(() => assertDeclaredApkMatches(verifiedFixture, { ...declared, ...override }))
      .toThrow(ActionException);
  });

  it('does not reveal which field mismatched', () => {
    try {
      assertDeclaredApkMatches(verifiedFixture, { ...declared, versionCode: 43 });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ActionException);
      expect((error as ActionException).code).toBe('VALIDATION');
      expect((error as ActionException).message).toBe('Gönderilen bilgiler geçerli değil.');
    }
  });
});
