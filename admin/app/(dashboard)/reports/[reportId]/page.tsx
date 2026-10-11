import type { Metadata } from 'next';
import Link from 'next/link';

import { ReportCloseForm } from '../../../../src/features/reports/report-close-form';
import { getReport } from '../../../../src/features/reports/report-dal';

export const metadata: Metadata = { title: 'Şikâyet detayı' };

export default async function ReportDetailPage({ params }: Readonly<{ params: Promise<{ reportId: string }> }>) {
  const { reportId } = await params;
  const report = await getReport(reportId);
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Şikâyet</p><h1>{report.apps?.title ?? 'Bilinmeyen uygulama'}</h1><p className="muted">{report.reason} · {report.status}</p></div><Link href="/reports">Listeye dön</Link></header>
      <section className="panel-section"><h2>Bağlam</h2><dl className="detail-list"><div><dt>Bildiren</dt><dd>{report.profiles?.username ?? report.reporter_id}</dd></div><div><dt>Sürüm</dt><dd>{report.app_versions?.version_name ?? 'Genel uygulama şikâyeti'}</dd></div><div><dt>Açıklama</dt><dd>{report.description || 'Açıklama yok.'}</dd></div>{report.admin_note ? <div><dt>Yönetici notu</dt><dd>{report.admin_note}</dd></div> : null}</dl></section>
      {report.status === 'open' ? <ReportCloseForm reportId={report.id} /> : <div className="form-success" role="status">Bu şikâyet kapatılmıştır; yeniden açma desteklenmez.</div>}
    </>
  );
}
