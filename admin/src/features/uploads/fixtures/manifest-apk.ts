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
const RES_XML_START_ELEMENT_TYPE = 0x0102;

function utf8StringBytes(s: string): Uint8Array {
  // AXML UTF-8 string cell: [discard length cell][ULEB128 char length][UTF-8 bytes]
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(1 + 1 + bytes.length);
  out[0] = 0x03;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

/** Builds an AXML string-pool chunk (UTF-8), canonical 28-byte header. */
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

  const headerSize = 28;
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
  dv.setUint32(24, 0, true); // stylesStart
  for (let i = 0; i < strings.length; i++) {
    dv.setUint32(headerSize + i * 4, offsets[i], true);
  }
  buf.set(stringData, headerSize + strings.length * 4);
  return buf;
}

/**
 * Builds an AXML start-element chunk with the canonical layout: a 16-byte
 * `ResXMLTree_node` followed by the 20-byte `ResXMLTree_attrExt`, so
 * attributes begin at `node + 36` (`headerSize + attributeStart`).
 * Each attribute: { nameIdx, rawValueIdx, valueType?, valueData? }.
 * When rawValueIdx !== 0xffffffff it is a string-pool reference.
 */
export function buildStartElement(
  tagNameIdx: number,
  attributes: readonly { nameIdx: number; rawValueIdx: number; valueType?: number; valueData?: number }[],
): Uint8Array {
  const headerSize = 16;
  const attrExtSize = 20;
  const attributesStart = headerSize + attrExtSize;
  const chunkSize = attributesStart + attributes.length * 20;
  const buf = new Uint8Array(chunkSize);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint16(0, RES_XML_START_ELEMENT_TYPE, true);
  dv.setUint16(2, headerSize, true);
  dv.setUint32(4, chunkSize, true);
  dv.setUint32(8, 0, true); // lineNumber
  dv.setUint32(12, 0, true);
  dv.setUint32(16, 0, true); // ns
  dv.setUint32(20, tagNameIdx, true);
  dv.setUint16(24, attrExtSize, true); // attributeStart
  dv.setUint16(26, 20, true); // attributeSize
  dv.setUint16(28, attributes.length, true);
  dv.setUint16(30, 0, true); // idIndex
  dv.setUint16(32, 0, true); // classIndex
  dv.setUint16(34, 0, true); // styleIndex

  let offset = attributesStart;
  for (const { nameIdx, rawValueIdx, valueType = 0, valueData = 0 } of attributes) {
    dv.setUint32(offset + 0, 0, true); // ns
    dv.setUint32(offset + 4, nameIdx, true);
    dv.setUint32(offset + 8, rawValueIdx, true);
    dv.setUint8(offset + 15, valueType);
    dv.setUint32(offset + 16, valueData, true);
    offset += 20;
  }
  return buf;
}

export function buildDocumentHeader(documentSize: number): Uint8Array {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint16(0, RES_XML_TYPE, true);
  dv.setUint16(2, 8, true);
  dv.setUint32(4, documentSize, true);
  return buf;
}

interface BuildManifestXmlOptions {
  packageName?: string;
  versionName?: string;
  versionCode?: string | number;
  minSdkVersion?: string | number;
  targetSdkVersion?: string | number;
  versionCodeMajor?: string | number;
  /** Pads the AXML document with an unknown chunk up to this byte length. */
  padToBytes?: number;
  // When true, omits the structured attributes entirely (string pool may still
  // contain plausible strings to test that no heuristic fallback is used).
  emptyManifest?: boolean;
}

function buildUnknownChunk(payloadBytes: number): Uint8Array {
  const size = 8 + Math.max(0, payloadBytes);
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint16(0, 0x7777, true);
  dv.setUint16(2, 8, true);
  dv.setUint32(4, size, true);
  return buf;
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
  const versionCodeMajorAttrIdx = idx('versionCodeMajor');
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
    add(versionCodeMajorAttrIdx, opts.versionCodeMajor);
  }
  if (opts.minSdkVersion !== undefined) add(minSdkAttrIdx, opts.minSdkVersion);
  if (opts.targetSdkVersion !== undefined) add(targetSdkAttrIdx, opts.targetSdkVersion);

  const body: Uint8Array[] = [buildStringPool(strings), buildStartElement(manifestTagIdx, attributes)];
  const baseSize = 8 + body.reduce((total, chunk) => total + chunk.length, 0);
  const padBytes = (opts.padToBytes ?? 0) - baseSize;
  if (padBytes > 0) body.push(buildUnknownChunk(padBytes));
  const documentSize = 8 + body.reduce((total, chunk) => total + chunk.length, 0);
  const chunks: Uint8Array[] = [buildDocumentHeader(documentSize), ...body];
  return concatUint8Arrays(chunks);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE), as stored by ZIP local, central and descriptor records. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * ZIP local file header (30 bytes) + file name + extra.
 *
 * With a data descriptor the header sets flag bit 3 and keeps CRC and both
 * sizes at zero; the real values follow the entry data.
 */
function buildLocalHeader(
  name: string,
  method: number,
  compressedSize: number,
  uncompressedSize: number = compressedSize,
  dataDescriptor = false,
  crc = 0,
): { header: Uint8Array; nameBytes: Uint8Array; extraLen: number } {
  const nameBytes = new TextEncoder().encode(name);
  const header = new Uint8Array(30);
  const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  dv.setUint32(0, 0x04034b50, true); // signature PK\x03\x04
  dv.setUint16(4, 20, true); // version needed
  dv.setUint16(6, dataDescriptor ? 0x0008 : 0, true); // flag
  dv.setUint16(8, method, true); // compression method
  dv.setUint16(10, 0, true); // mod time
  dv.setUint16(12, 0, true); // mod date
  dv.setUint32(14, dataDescriptor ? 0 : crc, true);
  dv.setUint32(18, dataDescriptor ? 0 : compressedSize, true);
  dv.setUint32(22, dataDescriptor ? 0 : uncompressedSize, true);
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
  uncompressedSize: number = compressedSize,
  crc = 0,
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
  dv.setUint32(16, crc, true); // crc32
  dv.setUint32(20, compressedSize, true);
  dv.setUint32(24, uncompressedSize, true);
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

/** Builds an EOCD record, optionally followed by a standard ZIP comment. */
function buildEocd(
  cdSize: number,
  cdOffset: number,
  totalEntries: number,
  comment: string = '',
): Uint8Array {
  const commentBytes = new TextEncoder().encode(comment);
  const buf = new Uint8Array(22 + commentBytes.length);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint32(0, 0x06054b50, true); // signature PK\x05\x06
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, totalEntries, true);
  dv.setUint16(10, totalEntries, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, cdOffset, true);
  dv.setUint16(20, commentBytes.length, true);
  buf.set(commentBytes, 22);
  return buf;
}

/** ZIP compression methods. */
export const COMPRESSION_STORED = 0;
export const COMPRESSION_DEFLATE = 8;

interface ZipEntrySpec {
  name: string;
  data: Uint8Array;
  method: number;
  uncompressedSize?: number;
  /** CRC-32 of the uncompressed data. */
  crc: number;
  /** Writes the entry with flag bit 3 and a trailing data descriptor. */
  dataDescriptor?: boolean;
}

/** Data descriptor after an entry whose local sizes are deferred. */
function buildDataDescriptor(
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
): Uint8Array {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint32(0, 0x08074b50, true); // optional signature PK\x07\x08
  dv.setUint32(4, crc, true);
  dv.setUint32(8, compressedSize, true);
  dv.setUint32(12, uncompressedSize, true);
  return buf;
}

/** Assembles a complete ZIP archive from already-compressed entries. */
function assembleZip(specs: readonly ZipEntrySpec[], comment: string = ''): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const spec of specs) {
    const { header, nameBytes, extraLen } = buildLocalHeader(
      spec.name,
      spec.method,
      spec.data.length,
      spec.uncompressedSize,
      spec.dataDescriptor,
      spec.crc,
    );
    const descriptor = spec.dataDescriptor
      ? buildDataDescriptor(
        spec.crc,
        spec.data.length,
        spec.uncompressedSize ?? spec.data.length,
      )
      : null;
    local.push(header, nameBytes, spec.data, ...(descriptor ? [descriptor] : []));
    central.push(buildCentralEntry(
      spec.name,
      spec.method,
      spec.data.length,
      offset,
      spec.uncompressedSize,
      spec.crc,
    ));
    offset += 30 + nameBytes.length + extraLen + spec.data.length + (descriptor?.length ?? 0);
  }
  const centralDirectory = concatUint8Arrays(central);
  const eocd = buildEocd(centralDirectory.length, offset, specs.length, comment);
  return concatUint8Arrays([...local, centralDirectory, eocd]);
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
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
  return concatUint8Arrays(chunks);
}

function blobFromBytes(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as ArrayBuffer], {
    type: 'application/vnd.android.package-archive',
  });
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
    /** Writes the manifest with a local data descriptor (flag bit 3). */
    dataDescriptor?: boolean;
    /** Appends a standard ZIP comment after the EOCD. */
    eocdComment?: string;
  } = {},
): Promise<Blob> {
  const method = opts.unsupportedMethod !== undefined ? opts.unsupportedMethod : (opts.method ?? COMPRESSION_STORED);
  const compressed = method === COMPRESSION_DEFLATE ? await deflateRaw(axml) : axml;

  const specs: ZipEntrySpec[] = [];
  const manifestName = 'AndroidManifest.xml';
  const manifestTimes = opts.duplicateManifest ? 2 : 1;
  for (let i = 0; i < manifestTimes; i++) {
    specs.push({
      name: manifestName,
      data: compressed,
      method,
      uncompressedSize: axml.length,
      crc: crc32(axml),
      dataDescriptor: opts.dataDescriptor,
    });
  }
  if (opts.padBytes && opts.padBytes > 0) {
    const padding = new Uint8Array(opts.padBytes);
    specs.push({
      name: 'padding.bin',
      data: padding,
      method: COMPRESSION_STORED,
      crc: crc32(padding),
    });
  }

  return blobFromBytes(assembleZip(specs, opts.eocdComment));
}

/**
 * Creates a structurally valid APK Blob containing a binary `AndroidManifest.xml`.
 */
export async function createValidApk(opts: BuildManifestXmlOptions = {}): Promise<Blob> {
  return createApkFromXmlBytes(buildManifestXml(opts));
}

/** Creates a valid ZIP Blob with no `AndroidManifest.xml`. */
export async function createApkWithoutManifest(): Promise<Blob> {
  const data = new Uint8Array([0, 1, 2, 3]);
  const crc = crc32(data);
  const zipLocal = buildLocalHeader('resources.arsc', COMPRESSION_STORED, 4, 4, false, crc);
  const afterData = 30 + zipLocal.nameBytes.length + zipLocal.extraLen + data.length;
  const central = buildCentralEntry('resources.arsc', COMPRESSION_STORED, 4, 0, 4, crc);
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

function sampleAxml(packageName = 'com.example.app'): Uint8Array {
  return buildManifestXml({ packageName, versionName: '1.0.0', versionCode: 1 });
}

function readEocdOffset(bytes: Uint8Array): number {
  return bytes.length - 22;
}

/** Creates an APK whose central directory claims an oversized manifest entry. */
export async function createApkWithManifestCompressedSize(compressedSize: number): Promise<Blob> {
  const file = await createApkFromXmlBytes(sampleAxml(), { padBytes: compressedSize });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = readEocdOffset(bytes);
  const cdOffset = dv.getUint32(eocd + 16, true);
  dv.setUint32(cdOffset + 20, compressedSize, true);
  return blobFromBytes(bytes);
}

/**
 * Creates a real ZIP bomb: a small deflate stream that inflates to a valid AXML
 * document larger than the uncompressed cap.
 */
export async function createApkBombManifest(uncompressedBytes: number): Promise<Blob> {
  const axml = buildManifestXml({
    packageName: 'com.example.bomb',
    versionName: '1.0',
    versionCode: 1,
    padToBytes: uncompressedBytes,
  });
  const compressed = await deflateRaw(axml);
  return blobFromBytes(assembleZip([
    {
      name: 'AndroidManifest.xml',
      data: compressed,
      method: COMPRESSION_DEFLATE,
      uncompressedSize: axml.length,
      crc: crc32(axml),
    },
  ]));
}

/** Creates an APK whose EOCD declares an oversized central directory. */
export async function createApkWithCentralDirectorySize(cdSize: number): Promise<Blob> {
  const file = await createApkFromXmlBytes(sampleAxml(), { padBytes: cdSize });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = readEocdOffset(bytes);
  dv.setUint32(eocd + 12, cdSize, true);
  dv.setUint32(eocd + 16, 0, true);
  return blobFromBytes(bytes);
}

/** Creates an APK whose second central-directory entry has a broken signature. */
export async function createApkWithCorruptCentralDirectory(): Promise<Blob> {
  const file = await createApkFromXmlBytes(sampleAxml(), { padBytes: 1024 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = readEocdOffset(bytes);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const firstEntryLength = 46 + new TextEncoder().encode('AndroidManifest.xml').length;
  dv.setUint32(cdOffset + firstEntryLength, 0, true);
  return blobFromBytes(bytes);
}

/** Creates an APK whose EOCD uses the ZIP64 entry-count sentinel. */
export async function createApkWithZip64Eocd(): Promise<Blob> {
  const file = await createValidApk({ packageName: 'com.example.zip64', versionName: '1.0', versionCode: 1 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = readEocdOffset(bytes);
  dv.setUint16(eocd + 8, 0xffff, true);
  dv.setUint16(eocd + 10, 0xffff, true);
  return blobFromBytes(bytes);
}
