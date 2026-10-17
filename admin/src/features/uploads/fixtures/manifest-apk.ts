/**
 * Real ZIP/AXML APK fixture builders for the browser APK manifest adapter tests.
 *
 * Produces structurally valid APKs: ZIP archives whose `AndroidManifest.xml` is a
 * genuine Android binary XML (AXML) document. No stubs or mocks are used as
 * production code or fixtures.
 *
 * AXML layout produced (matches what a strict AXML reader expects):
 *   - document header chunk (type 0x0003)
 *   - string pool chunk (type 0x0001, UTF-8 flag 0x100)
 *   - start element chunk(s) (type 0x0200) with string-reference attributes
 *
 * ZIP layout:
 *   local file header + (stored or deflate) data + central directory + EOCD
 */

import { concatUint8Arrays } from './zip-util';

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_START_ELEMENT_TYPE = 0x0200;

function utf8StringBytes(s: string): Uint8Array {
  // AXML UTF-8 string cell: [discard length cell][ULEB128 char length][UTF-8 bytes]
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(1 + 1 + bytes.length);
  out[0] = 0x03;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

/** Builds an AXML string-pool chunk (UTF-8). */
export function buildStringPool(strings: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  for (const s of strings) {
    offsets.push(cursor);
    const encoded = utf8StringBytes(s);
    parts.push(encoded);
    cursor += encoded.length;
  }
  const stringData = concatUint8Arrays(parts);

  const headerSize = 24;
  const chunkSize = headerSize + strings.length * 4 + stringData.length;
  const buf = new Uint8Array(chunkSize);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint16(0, RES_STRING_POOL_TYPE, true);
  dv.setUint16(2, headerSize, true);
  dv.setUint32(4, chunkSize, true);
  dv.setUint32(8, strings.length, true); // stringCount
  dv.setUint32(12, 0, true); // styleCount
  dv.setUint32(16, 0x100, true); // flags: UTF-8
  dv.setUint32(20, headerSize + strings.length * 4, true); // stringsStart
  for (let i = 0; i < strings.length; i++) {
    dv.setUint32(headerSize + i * 4, offsets[i], true);
  }
  buf.set(stringData, headerSize + strings.length * 4);
  return buf;
}

/**
 * Builds an AXML start-element chunk.
 * Each attribute: { nameIdx, rawValueIdx, valueType?, valueData? }.
 * When rawValueIdx !== 0xffffffff it is a string-pool reference.
 */
export function buildStartElement(
  tagNameIdx: number,
  attributes: readonly { nameIdx: number; rawValueIdx: number; valueType?: number; valueData?: number }[],
): Uint8Array {
  const headerSize = 32;
  const chunkSize = headerSize + attributes.length * 20;
  const buf = new Uint8Array(chunkSize);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint16(0, RES_XML_START_ELEMENT_TYPE, true);
  dv.setUint16(2, headerSize, true);
  dv.setUint32(4, chunkSize, true);
  dv.setUint32(8, 0, true); // lineNumber
  dv.setUint32(12, 0, true);
  dv.setUint32(16, 0, true);
  dv.setUint32(20, tagNameIdx, true);
  dv.setUint16(24, 0, true); // attrStart (relative to header end)
  dv.setUint16(26, 20, true); // attrSize
  dv.setUint16(28, attributes.length, true);
  dv.setUint16(30, 0, true);

  let offset = headerSize;
  for (const { nameIdx, rawValueIdx, valueType = 0, valueData = 0 } of attributes) {
    dv.setUint32(offset + 0, 0, true); // reserved
    dv.setUint32(offset + 4, nameIdx, true);
    dv.setUint32(offset + 8, rawValueIdx, true);
    dv.setUint8(offset + 15, valueType);
    dv.setUint32(offset + 16, valueData, true);
    offset += 20;
  }
  return buf;
}

export function buildDocumentHeader(): Uint8Array {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint16(0, RES_XML_TYPE, true);
  dv.setUint16(2, 8, true);
  dv.setUint32(4, 8, true);
  return buf;
}

interface BuildManifestXmlOptions {
  packageName?: string;
  versionName?: string;
  versionCode?: string | number;
  minSdkVersion?: string | number;
  targetSdkVersion?: string | number;
  // When true, omits the structured attributes entirely (string pool may still
  // contain plausible strings to test that no heuristic fallback is used).
  emptyManifest?: boolean;
}

/** Builds a complete `AndroidManifest.xml` AXML document. */
export function buildManifestXml(opts: BuildManifestXmlOptions = {}): Uint8Array {
  const strings: string[] = [];
  const idx = (value: string): number => {
    const existing = strings.indexOf(value);
    if (existing !== -1) return existing;
    strings.push(value);
    return strings.length - 1;
  };

  const manifestTagIdx = idx('manifest');
  const packageAttrIdx = idx('package');
  const versionNameAttrIdx = idx('versionName');
  const versionCodeAttrIdx = idx('versionCode');
  const minSdkAttrIdx = idx('minSdkVersion');
  const targetSdkAttrIdx = idx('targetSdkVersion');

  const attributes: { nameIdx: number; rawValueIdx: number; valueType?: number; valueData?: number }[] = [];

  const add = (attrIdx: number, value: string | number | undefined) => {
    if (value === undefined) return;
    attributes.push({ nameIdx: attrIdx, rawValueIdx: idx(String(value)), valueType: 0, valueData: 0 });
  };

  if (!opts.emptyManifest) {
    add(packageAttrIdx, opts.packageName);
    add(versionNameAttrIdx, opts.versionName);
    add(versionCodeAttrIdx, opts.versionCode);
  }
  if (opts.minSdkVersion !== undefined) add(minSdkAttrIdx, opts.minSdkVersion);
  if (opts.targetSdkVersion !== undefined) add(targetSdkAttrIdx, opts.targetSdkVersion);

  const chunks: Uint8Array[] = [buildDocumentHeader(), buildStringPool(strings)];
  chunks.push(buildStartElement(manifestTagIdx, attributes));
  return concatUint8Arrays(chunks);
}

/** ZIP local file header (30 bytes) + file name + extra. */
function buildLocalHeader(name: string, method: number, compressedSize: number): { header: Uint8Array; nameBytes: Uint8Array; extraLen: number } {
  const nameBytes = new TextEncoder().encode(name);
  const header = new Uint8Array(30);
  const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  dv.setUint32(0, 0x04034b50, true); // signature PK\x03\x04
  dv.setUint16(4, 20, true); // version needed
  dv.setUint16(6, 0, true); // flag
  dv.setUint16(8, method, true); // compression method
  dv.setUint16(10, 0, true); // mod time
  dv.setUint16(12, 0, true); // mod date
  dv.setUint32(14, 0, true); // crc32
  dv.setUint32(18, compressedSize, true);
  dv.setUint32(22, compressedSize, true); // uncompressed (stored) / actual for deflate
  dv.setUint16(26, nameBytes.length, true);
  dv.setUint16(28, 0, true); // extra length
  return { header, nameBytes, extraLen: 0 };
}

/** Builds a central directory entry (46 bytes fixed + variable fields). */
function buildCentralEntry(
  name: string,
  method: number,
  compressedSize: number,
  localOffset: number,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const buf = new Uint8Array(46 + nameBytes.length);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint32(0, 0x02014b50, true); // signature PK\x01\x02
  dv.setUint16(4, 20, true);
  dv.setUint16(6, 20, true);
  dv.setUint16(8, 0, true);
  dv.setUint16(10, method, true);
  dv.setUint16(12, 0, true);
  dv.setUint16(14, 0, true);
  dv.setUint32(16, 0, true); // crc32
  dv.setUint32(20, compressedSize, true);
  dv.setUint32(24, compressedSize, true);
  dv.setUint16(28, nameBytes.length, true);
  dv.setUint16(30, 0, true);
  dv.setUint16(32, 0, true);
  dv.setUint16(34, 0, true);
  dv.setUint16(36, 0, true);
  dv.setUint32(38, 0, true);
  dv.setUint32(42, localOffset, true);
  buf.set(nameBytes, 46);
  return buf;
}

/** Builds an EOCD record. */
function buildEocd(cdSize: number, cdOffset: number, totalEntries: number): Uint8Array {
  const buf = new Uint8Array(22);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint32(0, 0x06054b50, true); // signature PK\x05\x06
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, totalEntries, true);
  dv.setUint16(10, totalEntries, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, cdOffset, true);
  dv.setUint16(20, 0, true);
  return buf;
}

/** ZIP compression methods. */
export const COMPRESSION_STORED = 0;
export const COMPRESSION_DEFLATE = 8;

interface ApkEntry {
  header: Uint8Array;
  nameBytes: Uint8Array;
  data: Uint8Array;
  method: number;
  compressedSize: number;
  localOffset: number;
  name: string;
}

/**
 * Assembles an APK Blob from one or more ZIP entries plus a manifest AXML
 * document. Optional `padBytes` appends a large stored zero-filled entry so the
 * file is large while extraction still only reads small slices.
 */
export async function createApkFromXmlBytes(
  axml: Uint8Array,
  opts: {
    method?: number;
    duplicateManifest?: boolean;
    unsupportedMethod?: number;
    padBytes?: number;
  } = {},
): Promise<Blob> {
  const method = opts.unsupportedMethod !== undefined ? opts.unsupportedMethod : (opts.method ?? COMPRESSION_STORED);
  const manifestBytes = axml;
  let compressed = manifestBytes;
  if (method === COMPRESSION_DEFLATE) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(manifestBytes);
        controller.close();
      },
    }).pipeThrough(new CompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value!);
    }
    compressed = concatUint8Arrays(chunks);
  }

  const entries: ApkEntry[] = [];
  let offset = 0;
  const addEntry = (name: string, data: Uint8Array, method: number) => {
    const { header, nameBytes, extraLen } = buildLocalHeader(name, method, data.length);
    const localOffset = offset;
    offset += 30 + nameBytes.length + extraLen + data.length;
    entries.push({ header, nameBytes, data, method, compressedSize: data.length, localOffset, name });
  };

  const manifestName = 'AndroidManifest.xml';
  const manifestTimes = opts.duplicateManifest ? 2 : 1;
  for (let i = 0; i < manifestTimes; i++) {
    addEntry(manifestName, compressed, method);
  }
  if (opts.padBytes && opts.padBytes > 0) {
    addEntry('padding.bin', new Uint8Array(opts.padBytes), COMPRESSION_STORED);
  }

  const centralEntries: Uint8Array[] = [];
  for (const entry of entries) {
    centralEntries.push(buildCentralEntry(entry.name, entry.method, entry.compressedSize, entry.localOffset));
  }
  const centralDirectory = concatUint8Arrays(centralEntries);
  const cdOffset = offset;
  const cdSize = centralDirectory.length;
  const eocd = buildEocd(cdSize, cdOffset, entries.length);

  const all = concatUint8Arrays([
    ...entries.flatMap((e) => [e.header, e.nameBytes, e.data]),
    centralDirectory,
    eocd,
  ]);
  return new Blob([all as unknown as ArrayBuffer], { type: 'application/vnd.android.package-archive' });
}

/**
 * Creates a structurally valid APK Blob containing a binary `AndroidManifest.xml`.
 */
export async function createValidApk(opts: BuildManifestXmlOptions = {}): Promise<Blob> {
  return createApkFromXmlBytes(buildManifestXml(opts));
}

/** Creates a valid ZIP Blob with no `AndroidManifest.xml`. */
export async function createApkWithoutManifest(): Promise<Blob> {
  const zipLocal = buildLocalHeader('resources.arsc', COMPRESSION_STORED, 4);
  const data = new Uint8Array([0, 1, 2, 3]);
  const afterData = 30 + zipLocal.nameBytes.length + zipLocal.extraLen + data.length;
  const central = buildCentralEntry('resources.arsc', COMPRESSION_STORED, 4, 0);
  const cdOffset = afterData;
  const eocd = buildEocd(central.length, cdOffset, 1);
  const all = concatUint8Arrays([zipLocal.header, zipLocal.nameBytes, data, central, eocd]);
  return new Blob([all as unknown as ArrayBuffer], { type: 'application/vnd.android.package-archive' });
}

/** Creates a ZIP Blob with `AndroidManifest.xml` present twice. */
export async function createApkWithDuplicateManifest(): Promise<Blob> {
  return createApkFromXmlBytes(buildManifestXml({ packageName: 'com.example.app', versionName: '1.0.0', versionCode: '1' }), { duplicateManifest: true });
}

/** Creates a ZIP Blob whose manifest entry uses an unsupported compression method. */
export async function createApkUnsupportedCompression(): Promise<Blob> {
  return createApkFromXmlBytes(buildManifestXml({ packageName: 'com.example.app', versionName: '1.0.0', versionCode: '1' }), { unsupportedMethod: 9 });
}

/** Creates an APK whose manifest bytes are not valid AXML. */
export async function createApkMalformedManifest(): Promise<Blob> {
  const bad: Uint8Array = new Uint8Array([0, 1, 2, 3, 4, 5]);
  return createApkFromXmlBytes(bad);
}
