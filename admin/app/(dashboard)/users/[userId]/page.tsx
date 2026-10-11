import type { Metadata } from 'next';
import Link from 'next/link';

import { getManagedUser } from '../../../../src/features/users/user-dal';
import { UserDetail } from '../../../../src/features/users/user-detail';

export const metadata: Metadata = { title: 'Kullanıcı detayı' };

export default async function UserDetailPage({ params }: Readonly<{ params: Promise<{ userId: string }> }>) {
  const { userId } = await params;
  const user = await getManagedUser(userId);
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Auth kullanıcısı</p><h1>{user.username}</h1><p className="muted">{user.id}</p></div><Link href="/users">Listeye dön</Link></header>
      <UserDetail user={user} />
    </>
  );
}
