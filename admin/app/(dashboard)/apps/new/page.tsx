import type { Metadata } from 'next';
import Link from 'next/link';

import { AppForm } from '../../../../src/features/apps/app-form';
import { listCategories } from '../../../../src/features/apps/app-dal';

export const metadata: Metadata = { title: 'Yeni uygulama' };

export default async function NewAppPage() {
  const categories = await listCategories();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Katalog</p>
          <h1>Yeni uygulama</h1>
          <p className="muted">İndirme sayacı ve sistem alanları sunucu tarafından yönetilir.</p>
        </div>
        <Link href="/apps">Listeye dön</Link>
      </header>
      {categories.length ? (
        <AppForm categories={categories} />
      ) : (
        <div className="form-warning" role="status">Uygulama oluşturmadan önce bir kategori ekle.</div>
      )}
    </>
  );
}
