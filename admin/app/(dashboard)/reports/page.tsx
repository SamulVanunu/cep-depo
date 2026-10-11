import type { Metadata } from 'next';
import Link from 'next/link';

import { Pagination } from '../../../src/components/tables/pagination';
import { listReports } from '../../../src/features/reports/report-dal';
import type { RawSearchParams } from '../../../src/lib/search-params';

export const metadata: Metadata = { title: 'Şikâyetler' };

export default async function ReportsPage({ searchParams }: Readonly<{ searchParams: Promise<RawSearchParams> }>) {
  const raw = await searchParams;
  const page = Math.max(1, Number(typeof raw.page === 'string' ? raw.page : 1) || 1);
  const status = raw.status === 'open' || raw.status === 'resolved' || raw.status === 'dismissed' ? raw.status : undefined;
  const reason = typeof raw.reason === 'string' ? raw.reason : undefined;
  const result = await listReports({ page, pageSize: 25, status, reason });
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Topluluk</p><h1>Şikâyetler</h1><p className="muted">Açık kayıtları incele ve yönetici notuyla kapat.</p></div></header>
      <form className="filter-bar" method="get">
        <label className="field"><span>Durum</span><select defaultValue={status ?? ''} name="status"><option value="">Tümü</option><option value="open">Açık</option><option value="resolved">Çözüldü</option><option value="dismissed">Reddedildi</option></select></label>
        <label className="field"><span>Neden</span><input defaultValue={reason} maxLength={40} name="reason" /></label>
        <button className="secondary-button" type="submit">Filtrele</button>
      </form>
      <div className="table-shell"><table><caption className="visually-hidden">Şikâyet listesi</caption><thead><tr><th>Uygulama</th><th>Bildiren</th><th>Neden</th><th>Durum</th><th><span className="visually-hidden">İşlem</span></th></tr></thead><tbody>
        {result.items.map(report => <tr key={report.id}><td>{report.apps?.title ?? '—'}</td><td>{report.profiles?.username ?? '—'}</td><td>{report.reason}</td><td>{report.status}</td><td><Link href={`/reports/${report.id}`}>İncele</Link></td></tr>)}
      </tbody></table>{!result.items.length ? <p className="empty-table">Şikâyet bulunamadı.</p> : null}</div>
      <Pagination page={result.page} pageSize={result.pageSize} searchParams={raw} total={result.count} />
    </>
  );
}
