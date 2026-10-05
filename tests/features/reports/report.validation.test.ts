import {
  reportReasonOptions,
  validateReportDescription,
} from '../../../src/features/reports/report.validation';

describe('report validation', () => {
  it('exposes only database-backed reasons with Turkish labels', () => {
    expect(reportReasonOptions).toEqual([
      { value: 'acilmiyor', label: 'Uygulama açılmıyor' },
      { value: 'link_bozuk', label: 'İndirme bağlantısı bozuk' },
      { value: 'sahte_uygulama', label: 'Sahte veya yanıltıcı uygulama' },
      { value: 'diger', label: 'Diğer' },
    ]);
  });

  it('allows a blank optional description', () => {
    expect(validateReportDescription(' \t\n ')).toBeNull();
  });

  it('validates a trimmed non-empty description at 3–1000 characters', () => {
    expect(validateReportDescription(' ab ')).toBe(
      'Açıklama boş bırakılmalı veya en az 3 karakter olmalıdır.',
    );
    expect(validateReportDescription('a'.repeat(1000))).toBeNull();
    expect(validateReportDescription('a'.repeat(1001))).toBe(
      'Açıklama en fazla 1000 karakter olabilir.',
    );
  });
});
