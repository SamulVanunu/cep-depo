import { describe, expect, it } from 'vitest';

import {
  MAX_ICON_BYTES,
  extractLauncherIcon,
  extractLauncherIconFromBlob,
  iconMimeType,
  rankLauncherIcons,
} from './apk-icon';
import { blobByteSource, readZipDirectory } from './apk-manifest';
import { COMPRESSION_STORED, createApkWithEntries } from './fixtures/manifest-apk';

function png(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function webp(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

describe('extractLauncherIcon', () => {
  it('prefers the highest density launcher icon', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-hdpi/ic_launcher.png', data: png() },
      { name: 'res/mipmap-xxxhdpi/ic_launcher.png', data: png() },
      { name: 'res/mipmap-mdpi/ic_launcher.png', data: png() },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.path).toBe('res/mipmap-xxxhdpi/ic_launcher.png');
    expect(icon?.mimeType).toBe('image/png');
  });

  it('prefers ic_launcher over its adaptive layers', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-hdpi/ic_launcher.png', data: png() },
      { name: 'res/mipmap-xxxhdpi/ic_launcher_foreground.png', data: png() },
      { name: 'res/mipmap-xxxhdpi/ic_launcher_background.png', data: png() },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.path).toBe('res/mipmap-hdpi/ic_launcher.png');
  });

  it('prefers the exact ic_launcher file at the same density', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-hdpi/ic_launcher.png', data: png(32) },
      { name: 'res/mipmap-hdpi/ic_launcher_round.png', data: png(64) },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.path).toBe('res/mipmap-hdpi/ic_launcher.png');
  });

  it('prefers the larger file at the same density', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-hdpi/app_icon.png', data: png(32) },
      { name: 'res/mipmap-hdpi/badge.png', data: png(64) },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.path).toBe('res/mipmap-hdpi/badge.png');
  });

  it('falls back to any mipmap raster when no launcher name exists', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-xxhdpi/app_icon.png', data: png() },
      { name: 'res/drawable/app_icon.png', data: png() },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.path).toBe('res/mipmap-xxhdpi/app_icon.png');
  });

  it('detects a webp icon by its bytes', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-hdpi/ic_launcher.webp', data: webp() },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.mimeType).toBe('image/webp');
    expect(icon?.path).toBe('res/mipmap-hdpi/ic_launcher.webp');
  });

  it('skips a candidate whose bytes are not an image', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-xxxhdpi/ic_launcher.png', data: new Uint8Array(32) },
      { name: 'res/mipmap-hdpi/ic_launcher.png', data: png() },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.path).toBe('res/mipmap-hdpi/ic_launcher.png');
  });

  it('skips a candidate above the icon size limit', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-xxxhdpi/ic_launcher.png', data: png(MAX_ICON_BYTES + 1) },
      { name: 'res/mipmap-hdpi/ic_launcher.png', data: png() },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.path).toBe('res/mipmap-hdpi/ic_launcher.png');
  });

  it('returns null when only an adaptive xml icon exists', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-anydpi-v26/ic_launcher.xml', data: new Uint8Array(64) },
    ]);

    await expect(extractLauncherIcon(blobByteSource(apk))).resolves.toBeNull();
  });

  it('returns null for a blob that is not a zip archive', async () => {
    const blob = new Blob([new Uint8Array(1024)]);

    await expect(extractLauncherIconFromBlob(blob)).resolves.toBeNull();
  });

  it('stops after a bounded number of candidates', async () => {
    const decoys = Array.from({ length: 12 }, (_unused, index) => ({
      name: `res/mipmap-xxxhdpi/ic_launcher_${String(index).padStart(2, '0')}.png`,
      data: new Uint8Array(32),
    }));
    const apk = await createApkWithEntries([
      ...decoys,
      { name: 'res/mipmap-hdpi/ic_launcher.png', data: png() },
    ]);

    await expect(extractLauncherIcon(blobByteSource(apk))).resolves.toBeNull();
  });

  it('reads a deflated icon entry', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-hdpi/ic_launcher.png', data: png(), method: 8 },
    ]);

    const icon = await extractLauncherIcon(blobByteSource(apk));

    expect(icon?.bytes.length).toBe(32);
  });
});

describe('rankLauncherIcons', () => {
  it('orders candidates by density then name', async () => {
    const apk = await createApkWithEntries([
      { name: 'res/mipmap-mdpi/ic_launcher.png', data: png(), method: COMPRESSION_STORED },
      { name: 'res/mipmap-xxxhdpi/ic_launcher.png', data: png() },
    ]);

    const ranked = rankLauncherIcons(await readZipDirectory(blobByteSource(apk)));

    expect(ranked.map(entry => entry.name)).toEqual([
      'res/mipmap-xxxhdpi/ic_launcher.png',
      'res/mipmap-mdpi/ic_launcher.png',
    ]);
  });
});

describe('iconMimeType', () => {
  it('rejects bytes that are neither png nor webp', () => {
    expect(iconMimeType(new Uint8Array(16))).toBeNull();
  });
});
