import type { ReportReason } from './report.types';

export const reportReasonOptions: readonly { value: ReportReason; label: string }[] = [
  { value: 'acilmiyor', label: 'Uygulama açılmıyor' },
  { value: 'link_bozuk', label: 'İndirme bağlantısı bozuk' },
  { value: 'sahte_uygulama', label: 'Sahte veya yanıltıcı uygulama' },
  { value: 'diger', label: 'Diğer' },
];

export function validateReportDescription(value: string): string | null {
  const description = value.trim();
  if (description.length > 0 && description.length < 3) {
    return 'Açıklama boş bırakılmalı veya en az 3 karakter olmalıdır.';
  }
  if (description.length > 1000) return 'Açıklama en fazla 1000 karakter olabilir.';
  return null;
}
