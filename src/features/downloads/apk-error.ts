export type ApkDownloadErrorReason = 'source' | 'network' | 'size' | 'magic' | 'sha256';

const messages: Readonly<Record<ApkDownloadErrorReason, string>> = {
  source: 'Güvenli APK adresi oluşturulamadı.',
  network: 'APK bağlantısına ulaşılamadı.',
  size: 'APK dosya boyutu doğrulanamadı.',
  magic: 'İndirilen dosya geçerli bir APK değil.',
  sha256: 'APK bütünlük doğrulaması başarısız.',
};

export class ApkDownloadError extends Error {
  readonly reason: ApkDownloadErrorReason;

  constructor(reason: ApkDownloadErrorReason) {
    super(messages[reason]);
    this.name = 'ApkDownloadError';
    this.reason = reason;
  }
}
