import Link from 'next/link';

import { StatusBadge } from '../../components/status/status-badge';

type AppListResult = Awaited<ReturnType<typeof import('./app-dal')['listApps']>>;

export function AppList({ result }: Readonly<{ result: AppListResult }>) {
  return (
    <div className="table-shell">
      <table>
        <caption className="visually-hidden">Katalog uygulamaları</caption>
        <thead>
          <tr>
            <th scope="col">Uygulama</th>
            <th scope="col">Kategori</th>
            <th scope="col">Durum</th>
            <th scope="col">İndirme</th>
            <th scope="col"><span className="visually-hidden">İşlem</span></th>
          </tr>
        </thead>
        <tbody>
          {result.items.map(app => (
            <tr key={app.id}>
              <td><strong>{app.title}</strong><small>{app.slug}</small></td>
              <td>{app.categories?.name ?? '—'}</td>
              <td><StatusBadge tone={app.status === 'active' ? 'success' : 'neutral'}>{app.status === 'active' ? 'Aktif' : 'Arşiv'}</StatusBadge></td>
              <td>{new Intl.NumberFormat('tr-TR').format(app.download_count)}</td>
              <td><Link href={`/apps/${app.id}`}>Yönet</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.items.length === 0 ? <p className="empty-table">Filtrelerle eşleşen uygulama yok.</p> : null}
    </div>
  );
}
