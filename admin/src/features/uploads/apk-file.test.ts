import { describe, expect, it } from 'vitest';

import { validateApkFile } from './apk-file';
import { APK_MAX_BYTES, HOSTED_STORAGE_MAX_BYTES } from './upload-schema';

function fileOf(
  input: Readonly<{ name?: string; type?: string; size?: number }> = {},
): File {
  return {
    name: input.name ?? 'app.apk',
    type: input.type ?? 'application/vnd.android.package-archive',
    size: input.size ?? 1024,
  } as unknown as File;
}

describe('validateApkFile', () => {
  it('rejects a missing file', () => {
    expect(validateApkFile(null, 'storage')).toBe('Geçerli bir APK dosyası seçmelisin.');
    expect(validateApkFile(null, 'external')).toBe(
      'Önce bağlantıdaki APK’nın aynı yerel kopyasını seç.',
    );
  });

  it('rejects an empty file', () => {
    expect(validateApkFile(fileOf({ size: 0 }), 'storage')).toBe(
      'Geçerli bir APK dosyası seçmelisin.',
    );
  });

  it('rejects a file whose name is not .apk', () => {
    expect(validateApkFile(fileOf({ name: 'app.zip' }), 'storage')).toBe(
      'Dosya uzantısı .apk olmalıdır.',
    );
  });

  it('rejects an unverified mime type', () => {
    expect(validateApkFile(fileOf({ type: 'text/plain' }), 'storage')).toBe(
      'Seçilen dosyanın APK türü doğrulanamadı.',
    );
  });

  it('rejects a file above the hard limit', () => {
    expect(validateApkFile(fileOf({ size: APK_MAX_BYTES + 1 }), 'external')).toBe(
      'APK dosyası 500 MiB sınırını aşamaz.',
    );
  });

  it('rejects a storage upload above the hosted limit but allows it externally', () => {
    const oversized = fileOf({ size: HOSTED_STORAGE_MAX_BYTES + 1 });
    expect(validateApkFile(oversized, 'storage')).toBe(
      'Supabase Storage bu planda 50.000.000 bayt üzerindeki APK dosyalarını kabul etmez.',
    );
    expect(validateApkFile(oversized, 'external')).toBeNull();
  });

  it('accepts a valid apk', () => {
    expect(validateApkFile(fileOf(), 'storage')).toBeNull();
  });
});
