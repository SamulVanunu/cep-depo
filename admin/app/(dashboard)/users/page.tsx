import type { Metadata } from 'next';

import { Pagination } from '../../../src/components/tables/pagination';
import { listManagedUsers } from '../../../src/features/users/user-dal';
import { UserList } from '../../../src/features/users/user-list';
import { normalizeUserSearch } from '../../../src/features/users/user-schema';
import type { RawSearchParams } from '../../../src/lib/search-params';

export const metadata: Metadata = { title: 'Kullanıcılar' };

export default async function UsersPage({ searchParams }: Readonly<{ searchParams: Promise<RawSearchParams> }>) {
  const raw = await searchParams;
  const page = Math.max(1, Number(typeof raw.page === 'string' ? raw.page : 1) || 1);
  const search = normalizeUserSearch(typeof raw.query === 'string' ? raw.query : undefined);
  const result = await listManagedUsers({ page, perPage: 25, search });
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Auth</p><h1>Kullanıcılar</h1><p className="muted">Supabase Auth ve topluluk profil durumlarını birlikte yönet.</p></div></header>
      <form className="filter-bar" method="get"><label className="field"><span>E-posta ara</span><input defaultValue={search} maxLength={320} name="query" /></label><button className="secondary-button" type="submit">Ara</button></form>
      <UserList result={result} />
      <Pagination page={result.page} pageSize={result.pageSize} searchParams={raw} total={result.total} />
    </>
  );
}
