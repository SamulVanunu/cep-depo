import {
  blobByteSource,
  readZipDirectory,
  readZipEntry,
  type ApkByteSource,
  type ZipEntry,
} from './apk-manifest';

export type LauncherIcon = Readonly<{
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/webp';
  path: string;
}>;

/** Tek ikon dosyası için üst sınır. */
export const MAX_ICON_BYTES = 2 * 1024 * 1024;

const DENSITIES: Readonly<Record<string, number>> = {
  ldpi: 1,
  mdpi: 2,
  hdpi: 3,
  xhdpi: 4,
  xxhdpi: 5,
  xxxhdpi: 6,
};
const MIPMAP_RASTER = /^res\/mipmap-[^/]+\/[^/]+\.(png|webp)$/i;
const DENSITY_DIR = /^res\/mipmap-([a-z]+)(?:-v\d+)?\//i;
const LAUNCHER_NAME = /^ic_launcher/i;
const LAYER_NAME = /(foreground|background|monochrome)/i;

function baseName(entry: ZipEntry): string {
  return entry.name.slice(entry.name.lastIndexOf('/') + 1);
}

function densityOf(entry: ZipEntry): number {
  const match = DENSITY_DIR.exec(entry.name);
  if (!match) return 0;
  return DENSITIES[match[1]!.toLowerCase()] ?? 0;
}

function withinLimits(entry: ZipEntry): boolean {
  return entry.uncompressedSize > 0 && entry.uncompressedSize <= MAX_ICON_BYTES;
}

function compareCandidates(left: ZipEntry, right: ZipEntry): number {
  const density = densityOf(right) - densityOf(left);
  if (density !== 0) return density;
  const exact =
    Number(/^ic_launcher\./i.test(baseName(right))) - Number(/^ic_launcher\./i.test(baseName(left)));
  if (exact !== 0) return exact;
  const size = right.uncompressedSize - left.uncompressedSize;
  if (size !== 0) return size;
  return left.name.localeCompare(right.name);
}

/** Sıralı aday listesi; ilk geçerli görsel ikon olarak kullanılır. */
export function rankLauncherIcons(entries: readonly ZipEntry[]): readonly ZipEntry[] {
  const rasters = entries.filter(entry => MIPMAP_RASTER.test(entry.name) && withinLimits(entry));
  const launchers = rasters.filter(entry => LAUNCHER_NAME.test(baseName(entry)));
  const clean = launchers.filter(entry => !LAYER_NAME.test(baseName(entry)));
  const pool = clean.length > 0 ? clean : launchers.length > 0 ? launchers : rasters;
  return Object.freeze([...pool].sort(compareCandidates));
}

/** Görsel türünü uzantıya değil baytlara göre belirler. */
export function iconMimeType(bytes: Uint8Array): 'image/png' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export async function extractLauncherIcon(source: ApkByteSource): Promise<LauncherIcon | null> {
  const ranked = rankLauncherIcons(await readZipDirectory(source));
  for (const entry of ranked) {
    try {
      const bytes = await readZipEntry(source, entry, {
        maxCompressedBytes: MAX_ICON_BYTES,
        maxUncompressedBytes: MAX_ICON_BYTES,
      });
      const mimeType = iconMimeType(bytes);
      if (mimeType) return Object.freeze({ bytes, mimeType, path: entry.name });
    } catch {
      // Bozuk ya da sınırı aşan aday: sıradaki adaya geç.
    }
  }
  return null;
}

/** Tarayıcı girişi: ikon çıkarımı asla yayını engellemez. */
export async function extractLauncherIconFromBlob(file: Blob): Promise<LauncherIcon | null> {
  try {
    return await extractLauncherIcon(blobByteSource(file));
  } catch {
    return null;
  }
}
