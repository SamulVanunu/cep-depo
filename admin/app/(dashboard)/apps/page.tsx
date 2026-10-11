import type { Metadata } from 'next';
import Link from 'next/link';

import { Pagination } from '../../../src/components/tables/pagination';
import { AppList } from '../../../src/features/apps/app-list';
import { CategoryManager } from '../../../src/features/apps/category-manager';
import { listApps, listCategories } from '../../../src/features/apps/app-dal';
import { parseListParams, type RawSearchParams } from '../../../src/lib/search-params';

export const metadata: Metadata = { title: 'Uygulamalar' };

export default async function AppsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<RawSearchParams> }>) {
  const rawParams = await searchParams;
  const params = parseListParams(rawParams);
  const [result, categories] = await Promise.all([listApps(params), listCategories()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Katalog</p>
          <h1>Uygulamalar</h1>
          <p className="muted">Katalog kayıtlarını, kategorileri ve yayın varlıklarını yönet.</p>
        </div>
        <Link className="primary-button" href="/apps/new">Yeni uygulama</Link>
      </header>

      <form className="filter-bar" method="get">
        <label className="field">
          <span>Ara</span>
          <input defaultValue={params.query} maxLength={200} name="query" placeholder="Başlık veya slug" />
        </label>
        <label className="field">
          <span>Durum</span>
          <select defaultValue={params.status ?? ''} name="status">
            <option value="">Tümü</option>
            <option value="active">Aktif</option>
            <option value="archived">Arşivlenmiş</option>
          </select>
        </label>
        <label className="field">
          <span>Kategori</span>
          <select defaultValue={params.categoryId ?? ''} name="categoryId">
            <option value="">Tümü</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <button className="secondary-button" type="submit">Filtrele</button>
      </form>

      <AppList result={result} />
      <Pagination page={result.page} pageSize={result.pageSize} searchParams={rawParams} total={result.count} />
      <CategoryManager categories={categories} />
    </>
  );
}
