import { APK_MAX_BYTES, APK_MIME_TYPES, HOSTED_STORAGE_MAX_BYTES } from './upload-schema';

export type ApkFileSource = 'storage' | 'external';

/**
 * Client-side gate for a selected APK file. Returns the operator-facing reason
 * the file cannot be uploaded, or null when it may proceed.
 */
export function validateApkFile(file: File | null, source: ApkFileSource): string | null {
  if (!file || file.size === 0) {
    return source === 'external'
      ? 'Önce bağlantıdaki APK’nın aynı yerel kopyasını seç.'
      : 'Geçerli bir APK dosyası seçmelisin.';
  }
  if (!file.name.toLocaleLowerCase('tr-TR').endsWith('.apk')) return 'Dosya uzantısı .apk olmalıdır.';
  const mimeType = file.type || 'application/octet-stream';
  if (!APK_MIME_TYPES.includes(mimeType as (typeof APK_MIME_TYPES)[number])) {
    return 'Seçilen dosyanın APK türü doğrulanamadı.';
  }
  if (file.size > APK_MAX_BYTES) return 'APK dosyası 500 MiB sınırını aşamaz.';
  if (source === 'storage' && file.size > HOSTED_STORAGE_MAX_BYTES) {
    return 'Supabase Storage bu planda 50.000.000 bayt üzerindeki APK dosyalarını kabul etmez.';
  }
  return null;
}
