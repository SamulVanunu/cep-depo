/**
 * Browser-only APK manifest reader.
 *
 * Reads a ZIP/APK using only `Blob.slice` and `DecompressionStream` — it never
 * calls `Blob.arrayBuffer()` on the whole file. It decodes the Android binary
 * XML (`AndroidManifest.xml`) without any heuristic string-pool fallback, so
 * missing structured fields are rejected rather than synthesized.
 */

export interface ParsedApkManifest {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion?: number;
  targetSdkVersion?: number;
}

/** Single operator-safe Turkish error for every failure. */
const INVALID_APK_MANIFEST =
  'APK manifesti okunamadı. Lütfen geçerli bir APK dosyası seçin.';

const PACKAGE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const VERSION_CODE_MIN = 1;
const VERSION_CODE_MAX = 2_147_483_647;
const VERSION_NAME_MAX_LENGTH = 40;

const MANIFEST_NAME = 'AndroidManifest.xml';
const TAIL_WINDOW = 1 << 17; // 128 KB EOCD scan window

const ZIP_LOCAL_SIG = 0x04034b50; // PK\x03\x04
const ZIP_CENTRAL_SIG = 0x02014b50; // PK\x01\x02
const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATE = 8;

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RAW_VALUE_IDX_ABSENT = 0xffffffff;

function reject(): never {
  throw new Error(INVALID_APK_MANIFEST);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readLength8(view: DataView, offset: number): [number, number] {
  const first = view.getUint8(offset);
  if ((first & 0x80) === 0) return [first, 1];
  const second = view.getUint8(offset + 1);
  return [((first & 0x7f) << 7) | (second & 0x7f), 2];
}

function readLength16(view: DataView, offset: number): [number, number] {
  const first = view.getUint16(offset, true);
  if ((first & 0x8000) === 0) return [first, 2];
  const second = view.getUint16(offset + 2, true);
  return [((first & 0x7fff) << 16) | (second & 0x7fff), 4];
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sliceBuffer(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const ab = await blob.slice(start, end).arrayBuffer();
  return new Uint8Array(ab);
}

/** Reads an AXML string cell at `absOffset` (UTF-8 or UTF-16). */
function readAxmlString(view: DataView, absOffset: number, isUtf8: boolean): string {
  if (isUtf8) {
    const [, firstLenBytes] = readLength8(view, absOffset);
    const [utf8Len, secondLenBytes] = readLength8(view, absOffset + firstLenBytes);
    const start = absOffset + firstLenBytes + secondLenBytes;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + start, utf8Len);
    return new TextDecoder('utf-8').decode(bytes);
  }
  const [len, lenBytes] = readLength16(view, absOffset);
  const start = absOffset + lenBytes;
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(view.getUint16(start + i * 2, true));
  }
  return out;
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function parseCentralDirectory(cd: Uint8Array): CentralEntry[] {
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: CentralEntry[] = [];
  let cursor = 0;
  while (cursor + 46 <= cd.length) {
    if (readU32(view, cursor) !== ZIP_CENTRAL_SIG) break;
    const method = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const nameLen = readU16(view, cursor + 28);
    const extraLen = readU16(view, cursor + 30);
    const commentLen = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    const nameBytes = cd.subarray(cursor + 46, cursor + 46 + nameLen);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    entries.push({ name, method, compressedSize, localOffset });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

interface EndOfCentralDirectory {
  cdOffset: number;
  cdSize: number;
  totalEntries: number;
}

function findEndOfCentralDirectory(tail: Uint8Array): EndOfCentralDirectory | null {
  let found = -1;
  for (let i = tail.length - 4; i >= 0; i--) {
    if (
      tail[i] === 0x50 &&
      tail[i + 1] === 0x4b &&
      tail[i + 2] === 0x05 &&
      tail[i + 3] === 0x06
    ) {
      found = i;
      break;
    }
  }
  if (found === -1 || found + 22 > tail.length) return null;
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const cdSize = readU32(view, found + 12);
  const cdOffset = readU32(view, found + 16);
  const totalEntries = readU16(view, found + 10);
  return { cdOffset, cdSize, totalEntries };
}

function parseAxmlStringPool(
  view: DataView,
  chunkOffset: number,
): string[] {
  const stringCount = readU32(view, chunkOffset + 8);
  const flags = readU32(view, chunkOffset + 16);
  const isUtf8 = (flags & 0x100) !== 0;
  const headerSize = readU16(view, chunkOffset + 2);
  const stringsStart = readU32(view, chunkOffset + 20);
  const stringDataBase = chunkOffset + stringsStart;
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const offset = readU32(view, chunkOffset + headerSize + i * 4);
    strings.push(readAxmlString(view, stringDataBase + offset, isUtf8));
  }
  return strings;
}

interface AXmlAttribute {
  name: string;
  value: string | number;
  kind: 'string' | 'number';
  /** True when the value is a structured literal (string reference or inline
   *  integer), false when it is a resource reference or other indirect value. */
  literal: boolean;
}

interface AXmlElement {
  tag: string;
  attributes: AXmlAttribute[];
}

function processStartElement(
  view: DataView,
  cursor: number,
  strings: string[],
): AXmlElement {
  const headerSize = readU16(view, cursor + 2);
  const tagNameIdx = readU32(view, cursor + 20);
  const attrStart = readU16(view, cursor + 24);
  const attrSize = readU16(view, cursor + 26) || 20;
  const attrCount = readU16(view, cursor + 28);
  const tag = strings[tagNameIdx] ?? '';
  const attributes: AXmlAttribute[] = [];
  let attrCursor = cursor + headerSize + attrStart;
  for (let i = 0; i < attrCount; i++) {
    if (attrCursor + 20 > view.byteLength) reject();
    const nameIdx = readU32(view, attrCursor + 4);
    const rawValueIdx = readU32(view, attrCursor + 8);
    const valueType = view.getUint8(attrCursor + 15);
    const valueData = readU32(view, attrCursor + 16);
    const name = strings[nameIdx] ?? '';
    let value: string | number;
    let kind: 'string' | 'number';
    let literal: boolean;
    if (rawValueIdx !== RAW_VALUE_IDX_ABSENT) {
      value = strings[rawValueIdx] ?? '';
      kind = 'string';
      literal = true;
    } else if (valueType === 3) {
      value = strings[valueData] ?? '';
      kind = 'string';
      literal = true;
    } else if (valueType === 16 || valueType === 17) {
      value = valueData;
      kind = 'number';
      literal = true;
    } else {
      // Resource reference (e.g. TYPE_REFERENCE) or other indirect value: not
      // a structured literal, so it must not satisfy a version field.
      value = valueData;
      kind = 'number';
      literal = false;
    }
    attributes.push({ name, value, kind, literal });
    attrCursor += attrSize;
  }
  return { tag, attributes };
}

function parseAxml(data: Uint8Array): AXmlElement[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const elements: AXmlElement[] = [];
  let strings: string[] | null = null;
  let cursor = 0;

  // Document header chunk.
  if (cursor + 8 > data.length) reject();
  const documentSize = readU32(view, 4);
  if (
    readU16(view, 0) !== RES_XML_TYPE ||
    readU16(view, 2) !== 8 ||
    documentSize !== data.length
  ) {
    reject();
  }
  cursor = 8;

  while (cursor + 8 <= data.length) {
    const type = readU16(view, cursor);
    const chunkSize = readU32(view, cursor + 4);
    if (chunkSize < 8 || cursor + chunkSize > data.length) break;
    if (type === RES_STRING_POOL_TYPE) {
      strings = parseAxmlStringPool(view, cursor);
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      if (strings === null) reject();
      elements.push(processStartElement(view, cursor, strings));
    }
    cursor += chunkSize;
  }
  return elements;
}

function attributeByName(element: AXmlElement, name: string): AXmlAttribute | undefined {
  return element.attributes.find((attr) => attr.name === name);
}

function parsePositiveIntCode(value: string | number): number {
  let n: number;
  if (typeof value === 'string') {
    if (!/^[0-9]+$/.test(value)) reject();
    n = Number.parseInt(value, 10);
    if (Number.isNaN(n) || !Number.isFinite(n)) reject();
  } else {
    n = value;
  }
  if (!Number.isInteger(n) || !Number.isSafeInteger(n)) reject();
  if (n < VERSION_CODE_MIN || n > VERSION_CODE_MAX) reject();
  return n;
}

async function readEntryData(file: Blob, entry: CentralEntry): Promise<Uint8Array> {
  const header = await sliceBuffer(file, entry.localOffset, entry.localOffset + 32);
  if (header.length < 30) reject();
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (readU32(hv, 0) !== ZIP_LOCAL_SIG) reject();
  const nameLen = readU16(hv, 26);
  const extraLen = readU16(hv, 28);
  const dataOffset = entry.localOffset + 30 + nameLen + extraLen;
  if (dataOffset + entry.compressedSize > file.size) reject();

  if (entry.method === COMPRESSION_STORED) {
    return sliceBuffer(file, dataOffset, dataOffset + entry.compressedSize);
  }
  if (entry.method === COMPRESSION_DEFLATE) {
    const compressed = await sliceBuffer(
      file,
      dataOffset,
      dataOffset + entry.compressedSize,
    );
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(compressed);
        controller.close();
      },
    }).pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value!);
    }
    return concatUint8Arrays(chunks);
  }
  reject();
}

/**
 * Parses a browser-side APK manifest and returns a normalized, validated
 * `ParsedApkManifest`.
 *
 * Reads only small slices of the APK (ZIP magic, EOCD tail window, central
 * directory, local header, manifest entry data) and decompresses the manifest
 * entry with `DecompressionStream`. It never calls `Blob.arrayBuffer()` on the
 * whole file.
 *
 * Every parser or validation failure maps to the single Turkish error above.
 */
export async function parseApkManifest(file: Blob): Promise<ParsedApkManifest> {
  try {
    const size = file.size;

    // 1. ZIP local-file-header magic.
    const head = await sliceBuffer(file, 0, 4);
    if (
      head.length < 4 ||
      head[0] !== 0x50 ||
      head[1] !== 0x4b ||
      head[2] !== 0x03 ||
      head[3] !== 0x04
    ) {
      reject();
    }

    // 2. End of central directory (scan the tail window).
    const tailLen = Math.min(size, TAIL_WINDOW);
    const tail = await sliceBuffer(file, size - tailLen, size);
    const eocd = findEndOfCentralDirectory(tail);
    if (!eocd) reject();
    if (
      eocd.cdOffset < 0 ||
      eocd.cdSize < 0 ||
      eocd.cdOffset + eocd.cdSize > size
    ) {
      reject();
    }

    // 3. Central directory.
    const cd = await sliceBuffer(file, eocd.cdOffset, eocd.cdOffset + eocd.cdSize);
    const entries = parseCentralDirectory(cd);

    // 4. Locate exactly one `AndroidManifest.xml`.
    const manifestEntries = entries.filter((e) => e.name === MANIFEST_NAME);
    if (manifestEntries.length !== 1) reject();
    const entry = manifestEntries[0];
    if (entry.method !== COMPRESSION_STORED && entry.method !== COMPRESSION_DEFLATE) {
      reject();
    }

    // 5. Decompress the manifest entry (small slice only).
    const manifestBytes = await readEntryData(file, entry);

    // 6. Decode AXML without heuristic fallback.
    const elements = parseAxml(manifestBytes);
    const manifests = elements.filter((el) => el.tag === 'manifest');
    if (manifests.length !== 1) reject();
    const manifest = manifests[0];

    const packageAttr = attributeByName(manifest, 'package');
    const versionNameAttr = attributeByName(manifest, 'versionName');
    const versionCodeAttr = attributeByName(manifest, 'versionCode');

    if (!packageAttr || packageAttr.kind !== 'string') reject();
    if (!versionNameAttr || versionNameAttr.kind !== 'string') reject();
    if (!versionCodeAttr || !versionCodeAttr.literal) reject();

    const packageName = String(packageAttr.value).trim();
    const versionName = String(versionNameAttr.value).trim();

    if (!packageName || !PACKAGE_NAME_RE.test(packageName)) reject();
    if (!versionName || versionName.length > VERSION_NAME_MAX_LENGTH) reject();

    const versionCode = parsePositiveIntCode(versionCodeAttr.value);

    const result: ParsedApkManifest = { packageName, versionName, versionCode };

    const minSdkAttr = attributeByName(manifest, 'minSdkVersion');
    if (minSdkAttr) {
      const minSdk =
        typeof minSdkAttr.value === 'number'
          ? minSdkAttr.value
          : Number.parseInt(String(minSdkAttr.value), 10);
      if (!Number.isFinite(minSdk)) reject();
      result.minSdkVersion = minSdk;
    }
    const targetSdkAttr = attributeByName(manifest, 'targetSdkVersion');
    if (targetSdkAttr) {
      const targetSdk =
        typeof targetSdkAttr.value === 'number'
          ? targetSdkAttr.value
          : Number.parseInt(String(targetSdkAttr.value), 10);
      if (!Number.isFinite(targetSdk)) reject();
      result.targetSdkVersion = targetSdk;
    }

    return Object.freeze(result);
  } catch {
    reject();
  }
}
