import type { Metadata } from 'next';

import { listCategories } from '../../../src/features/apps/app-dal';
import { CategoryManager } from '../../../src/features/apps/category-manager';
import { listOrphanUploads } from '../../../src/features/uploads/upload-dal';
import { OrphanPanel } from '../../../src/features/uploads/orphan-panel';

export const metadata: Metadata = { title: 'Ayarlar' };

export default async function SettingsPage() {
  const [categories, orphanPaths] = await Promise.all([listCategories(), listOrphanUploads()]);
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Yönetim</p>
          <h1>Ayarlar</h1>
          <p className="muted">Katalog kategorilerini ve tamamlanmamış yüklemeleri yönet.</p>
        </div>
      </header>
      <CategoryManager categories={categories} />
      <OrphanPanel paths={orphanPaths} />
    </>
  );
}
