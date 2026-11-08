import { describe, expect, it } from 'vitest';

import {
  MAX_CENTRAL_DIRECTORY_BYTES,
  MAX_MANIFEST_COMPRESSED_BYTES,
  MAX_MANIFEST_UNCOMPRESSED_BYTES,
  parseApkManifest,
  parseApkManifestFromSource,
  readZipDirectory,
  readZipEntry,
  type ApkByteSource,
} from './apk-manifest';
import {
  COMPRESSION_DEFLATE,
  buildDocumentHeader,
  buildManifestXml,
  buildStartElement,
  buildStringPool,
  createApkBombManifest,
  createApkFromXmlBytes,
  createApkUnsupportedCompression,
  createApkWithCentralDirectorySize,
  createApkWithCorruptCentralDirectory,
  createApkWithDuplicateManifest,
  createApkWithManifestCompressedSize,
  createApkWithoutManifest,
  createApkWithZip64Eocd,
  createApkMalformedManifest,
  createValidApk,
} from './fixtures/manifest-apk';
import { concatUint8Arrays } from './fixtures/zip-util';

const EXPECTED_ERROR = 'APK manifesti okunamadı. Lütfen geçerli bir APK dosyası seçin.';
const TAIL_WINDOW = 128 * 1024;

async function fixtureSource(blob: Blob, sizes?: number[]): Promise<ApkByteSource> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    size: bytes.length,
    async read(start, endExclusive) {
      sizes?.push(endExclusive - start);
      return bytes.slice(start, endExclusive);
    },
  };
}

describe('parseApkManifest', () => {
  it('parses a structurally valid APK manifest (real ZIP/AXML)', async () => {
    const file = await createValidApk({
      packageName: 'com.example.app',
      versionName: '1.0.0',
      versionCode: 104,
      minSdkVersion: 21,
      targetSdkVersion: 33,
    });

    const result = await parseApkManifest(file);
    expect(result).toEqual({
      packageName: 'com.example.app',
      versionName: '1.0.0',
      versionCode: 104,
      minSdkVersion: 21,
      targetSdkVersion: 33,
    });
  });

  it('accepts the standard AXML document size in the root header', async () => {
    const { buildManifestXml } = await import('./fixtures/manifest-apk');
    const axml = buildManifestXml({
      packageName: 'com.example.real',
      versionName: '1.0.0',
      versionCode: 9,
    });
    const file = await createApkFromXmlBytes(axml);

    await expect(parseApkManifest(file)).resolves.toMatchObject({
      packageName: 'com.example.real',
      versionName: '1.0.0',
      versionCode: 9,
    });
  });

  it('parses the standard Android AXML start-element chunk type', async () => {
    const { buildManifestXml } = await import('./fixtures/manifest-apk');
    const axml = buildManifestXml({
      packageName: 'com.nuvio.tv',
      versionName: '1.0.0',
      versionCode: 1062,
    });
    const file = await createApkFromXmlBytes(axml);

    await expect(parseApkManifest(file)).resolves.toMatchObject({
      packageName: 'com.nuvio.tv',
      versionName: '1.0.0',
      versionCode: 1062,
    });
  });

  it('omits optional SDK versions when not declared', async () => {
    const file = await createValidApk({
      packageName: 'com.example.app',
      versionName: '2.0.0-beta',
      versionCode: 5,
    });

    const result = await parseApkManifest(file);
    expect(result).toEqual({
      packageName: 'com.example.app',
      versionName: '2.0.0-beta',
      versionCode: 5,
    });
    expect(result.minSdkVersion).toBeUndefined();
    expect(result.targetSdkVersion).toBeUndefined();
  });

  it('supports a deflate-compressed manifest entry', async () => {
    // Rebuild with deflate: the fixture helper defaults to stored; create directly.
    const deflateFile = await (async () => {
      const { buildManifestXml, createApkFromXmlBytes } = await import('./fixtures/manifest-apk');
      const axml = buildManifestXml({ packageName: 'com.example.app', versionName: '3.0.0', versionCode: '42' });
      return createApkFromXmlBytes(axml, { method: COMPRESSION_DEFLATE });
    })();
    const result = await parseApkManifest(deflateFile);
    expect(result.versionCode).toBe(42);
    expect(result.packageName).toBe('com.example.app');
  });

  it('normalizes only surrounding whitespace', async () => {
    const file = await createValidApk({
      packageName: '  com.example.app ',
      versionName: '  1.0.0 ',
      versionCode: 1,
    });

    const result = await parseApkManifest(file);
    expect(result.packageName).toBe('com.example.app');
    expect(result.versionName).toBe('1.0.0');
    expect(result.versionCode).toBe(1);
  });

  it.each([
    '123.invalid.app',   // segment starts with a digit
    '-invalid.app',      // segment starts with a hyphen
    '.invalid.app',      // leading dot
    'invalid.',          // trailing dot
    'no-dots-hyphen',    // hyphen in segment
    'no dots',           // space
  ])('rejects an invalid Android package name: %s', async (packageName) => {
    const file = await createValidApk({ packageName, versionName: '1.0.0', versionCode: 1 });
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a malformed (non-ZIP) APK', async () => {
    const file = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])]);
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects an APK without AndroidManifest.xml', async () => {
    const file = await createApkWithoutManifest();
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a malformed AXML manifest', async () => {
    const file = await createApkMalformedManifest();
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects when manifest exists but package/version/versionCode are absent (no heuristic fallback)', async () => {
    // String pool contains plausible package/version strings, but the manifest
    // start element only declares versionCode as a structured attribute, so a
    // reader that falls back to the string pool would synthesize them. We must
    // reject because structured package and versionName attributes are missing.
    const { buildManifestXml, createApkFromXmlBytes } = await import('./fixtures/manifest-apk');
    const axml = buildManifestXml({
      emptyManifest: true,
      versionCode: '7',
    });
    // Inject a string pool holding plausible values but no structured attrs.
    const file = await createApkFromXmlBytes(axml);
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects an empty package name', async () => {
    const file = await createValidApk({ packageName: '', versionName: '1.0.0', versionCode: 1 });
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects an empty version name', async () => {
    const file = await createValidApk({ packageName: 'com.example.app', versionName: '', versionCode: 1 });
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a versionCode of zero or below', async () => {
    const file = await createValidApk({ packageName: 'com.example.app', versionName: '1.0.0', versionCode: 0 });
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a versionCode outside the PostgreSQL integer range', async () => {
    const file = await createValidApk({
      packageName: 'com.example.app',
      versionName: '1.0.0',
      versionCode: 3_000_000_000,
    });
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects an overlong version name (more than 40 characters)', async () => {
    const file = await createValidApk({
      packageName: 'com.example.app',
      versionName: '1.2.345678901234567890123456789012345678901',
      versionCode: 1,
    });
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a resource-reference versionName instead of a structured string', async () => {
    const { buildManifestXml, createApkFromXmlBytes } = await import('./fixtures/manifest-apk');
    // versionName as an inline integer (not a string reference) is not a structured
    // string value for versionName.
    const axml = buildManifestXml({ packageName: 'com.example.app', versionName: undefined, versionCode: '1' });
    const file = await createApkFromXmlBytes(axml);
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a resource-reference versionCode instead of a structured literal', async () => {
    const RAW_VALUE_IDX_ABSENT = 0xffffffff;
    const strings = ['manifest', 'package', 'versionName', 'versionCode', 'com.example.app', '1.0.0'];
    const idx = (s: string) => strings.indexOf(s);
    const body = [
      buildStringPool(strings),
      buildStartElement(idx('manifest'), [
        { nameIdx: idx('package'), rawValueIdx: idx('com.example.app') },
        { nameIdx: idx('versionName'), rawValueIdx: idx('1.0.0') },
        // versionCode as a resource reference (not a structured literal).
        { nameIdx: idx('versionCode'), rawValueIdx: RAW_VALUE_IDX_ABSENT, valueType: 0x1f, valueData: 5 },
      ]),
    ];
    const documentSize = 8 + body.reduce((total, chunk) => total + chunk.length, 0);
    const axml = concatUint8Arrays([buildDocumentHeader(documentSize), ...body]);
    const file = await createApkFromXmlBytes(axml);
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a duplicate AndroidManifest.xml entry', async () => {
    const file = await createApkWithDuplicateManifest();
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects an unsupported ZIP compression method', async () => {
    const file = await createApkUnsupportedCompression();
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('does not read the whole APK via Blob.arrayBuffer on a large/sparse file', async () => {
    const padBytes = 2 * 1024 * 1024; // 2 MB zero-filled stored entry
    // Rebuild with padding to make the file large.
    const { buildManifestXml, createApkFromXmlBytes } = await import('./fixtures/manifest-apk');
    const axml = buildManifestXml({ packageName: 'com.example.app', versionName: '1.0.0', versionCode: '1' });
    const largeFile = await createApkFromXmlBytes(axml, { padBytes });

    const sliceSizes: number[] = [];
    const originalSlice = Blob.prototype.slice;
    Blob.prototype.slice = function (this: Blob, start?: number, end?: number) {
      if (start !== undefined && end !== undefined) sliceSizes.push(end - start);
      return originalSlice.call(this, start, end);
    } as unknown as typeof Blob.prototype.slice;
    try {
      const result = await parseApkManifest(largeFile);
      expect(result.packageName).toBe('com.example.app');
      expect(result.versionCode).toBe(1);
      // No slice may span the entire file.
      expect(sliceSizes.some((size) => size === largeFile.size)).toBe(false);
      // Total bytes sliced must be far smaller than the file (only header,
      // EOCD tail window, central directory, local header and manifest data).
      const totalSliced = sliceSizes.reduce((sum, n) => sum + n, 0);
      expect(totalSliced).toBeLessThan(largeFile.size / 4);
    } finally {
      Blob.prototype.slice = originalSlice;
    }
  });

  it('rejects when the file is too small to contain a ZIP', async () => {
    const file = new Blob([new Uint8Array([0x50, 0x4b, 0x03])]);
    await expect(parseApkManifest(file)).rejects.toThrow(EXPECTED_ERROR);
  });
});

describe('parseApkManifestFromSource hardening', () => {
  it('reads through ApkByteSource without a Blob', async () => {
    const file = await createValidApk({ packageName: 'com.example.src', versionName: '2.0', versionCode: 7 });
    const source = await fixtureSource(file);

    await expect(parseApkManifestFromSource(source)).resolves.toMatchObject({
      packageName: 'com.example.src',
      versionCode: 7,
    });
  });

  it('rejects a manifest entry above the compressed cap without reading it', async () => {
    const sizes: number[] = [];
    const source = await fixtureSource(
      await createApkWithManifestCompressedSize(MAX_MANIFEST_COMPRESSED_BYTES + 1),
      sizes,
    );

    await expect(parseApkManifestFromSource(source)).rejects.toThrow(EXPECTED_ERROR);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(TAIL_WINDOW);
  });

  it('rejects a manifest that inflates beyond the uncompressed cap', async () => {
    const source = await fixtureSource(
      await createApkBombManifest(MAX_MANIFEST_UNCOMPRESSED_BYTES + 1),
    );

    await expect(parseApkManifestFromSource(source)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a central directory above the size cap without reading it', async () => {
    const sizes: number[] = [];
    const source = await fixtureSource(
      await createApkWithCentralDirectorySize(MAX_CENTRAL_DIRECTORY_BYTES + 1),
      sizes,
    );

    await expect(parseApkManifestFromSource(source)).rejects.toThrow(EXPECTED_ERROR);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(TAIL_WINDOW);
  });

  it('rejects a truncated or inconsistent central directory', async () => {
    const source = await fixtureSource(await createApkWithCorruptCentralDirectory());

    await expect(parseApkManifestFromSource(source)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects a non-zero versionCodeMajor', async () => {
    const axml = buildManifestXml({
      packageName: 'com.example.app',
      versionName: '1.0',
      versionCode: 3,
      versionCodeMajor: 1,
    });
    const source = await fixtureSource(await createApkFromXmlBytes(axml));

    await expect(parseApkManifestFromSource(source)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('rejects the ZIP64 entry-count sentinel explicitly', async () => {
    const source = await fixtureSource(await createApkWithZip64Eocd());

    await expect(parseApkManifestFromSource(source)).rejects.toThrow(EXPECTED_ERROR);
  });

  it('never requests a slice larger than the tail window', async () => {
    const file = await createApkFromXmlBytes(
      buildManifestXml({ packageName: 'com.example.app', versionName: '1.0', versionCode: 1 }),
      { padBytes: 2 * 1024 * 1024 },
    );
    const sizes: number[] = [];

    await parseApkManifestFromSource(await fixtureSource(file, sizes));

    expect(Math.max(...sizes)).toBeLessThanOrEqual(TAIL_WINDOW);
  });

  it('parses an APK whose EOCD carries a comment', async () => {
    const file = await createApkFromXmlBytes(
      buildManifestXml({ packageName: 'com.example.comment', versionName: '1.2', versionCode: 5 }),
      { eocdComment: 'packaged by a real build tool' },
    );

    await expect(parseApkManifest(file)).resolves.toMatchObject({
      packageName: 'com.example.comment',
      versionName: '1.2',
      versionCode: 5,
    });
  });

  it('parses an APK written with local data descriptors', async () => {
    const file = await createApkFromXmlBytes(
      buildManifestXml({ packageName: 'com.example.descriptor', versionName: '2.1', versionCode: 9 }),
      { dataDescriptor: true },
    );

    await expect(parseApkManifest(file)).resolves.toMatchObject({
      packageName: 'com.example.descriptor',
      versionName: '2.1',
      versionCode: 9,
    });
  });

  it('propagates a byte-source failure instead of reporting an invalid APK', async () => {
    const failure = new Error('range request failed');
    const source: ApkByteSource = {
      size: 4096,
      async read() {
        throw failure;
      },
    };

    await expect(parseApkManifestFromSource(source)).rejects.toBe(failure);
  });

  it('normalizes a Blob read failure to the operator message', async () => {
    const broken = {
      size: 4096,
      slice() {
        throw new Error('blob unavailable');
      },
    } as unknown as Blob;

    await expect(parseApkManifest(broken)).rejects.toThrow(EXPECTED_ERROR);
  });
});

describe('zip directory helpers', () => {
  it('lists entries with their sizes from the central directory', async () => {
    const file = await createValidApk({
      packageName: 'com.example.entries',
      versionName: '1.0.0',
      versionCode: 3,
    });
    const entries = await readZipDirectory(await fixtureSource(file));

    const manifest = entries.find(entry => entry.name === 'AndroidManifest.xml');
    expect(manifest).toBeDefined();
    expect(manifest!.uncompressedSize).toBeGreaterThan(0);
    expect(manifest!.compressedSize).toBeGreaterThan(0);
  });

  it('reads an entry as its uncompressed bytes', async () => {
    const file = await createValidApk({
      packageName: 'com.example.entry',
      versionName: '1.2.0',
      versionCode: 12,
    });
    const source = await fixtureSource(file);
    const entries = await readZipDirectory(source);
    const manifest = entries.find(entry => entry.name === 'AndroidManifest.xml')!;

    const bytes = await readZipEntry(source, manifest);
    expect(bytes.length).toBe(manifest.uncompressedSize);
    // Android binary XML document header: RES_XML_TYPE (0x0003), headerSize 8.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x03, 0x00, 0x08, 0x00]);
  });
});
