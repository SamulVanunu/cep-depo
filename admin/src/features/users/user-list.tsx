import Link from 'next/link';

import { StatusBadge } from '../../components/status/status-badge';

type Result = Awaited<ReturnType<typeof import('./user-dal')['listManagedUsers']>>;

export function UserList({ result }: Readonly<{ result: Result }>) {
  return (
    <div className="table-shell"><table><caption className="visually-hidden">Auth kullanıcıları</caption><thead><tr><th>Kullanıcı</th><th>E-posta</th><th>Durum</th><th>Topluluk</th><th><span className="visually-hidden">İşlem</span></th></tr></thead><tbody>
      {result.items.map(user => <tr key={user.id}><td><strong>{user.username}</strong>{user.isAdmin ? <small>Yönetici</small> : null}</td><td>{user.email}</td><td><StatusBadge tone={user.consistency === 'partial' ? 'danger' : user.status === 'active' ? 'success' : 'warning'}>{user.consistency === 'partial' ? 'Kısmi durum' : user.status === 'active' ? 'Aktif' : 'Askıda'}</StatusBadge></td><td>{user.reviewCount} yorum · {user.reportCount} şikâyet</td><td><Link href={`/users/${user.id}`}>Yönet</Link></td></tr>)}
    </tbody></table>{!result.items.length ? <p className="empty-table">Kullanıcı bulunamadı.</p> : null}</div>
  );
}
