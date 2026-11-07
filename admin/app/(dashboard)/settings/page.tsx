import type { Metadata } from 'next';

import { listCategories } from '../../../src/features/apps/app-dal';
import { CategoryManager } from '../../../src/features/apps/category-manager';
import { StaticCatalogPanel } from '../../../src/features/catalog/static-json/panel';
import { listOrphanUploads } from '../../../src/features/uploads/upload-dal';
import { OrphanPanel } from '../../../src/features/uploads/orphan-panel';
import { getServerEnv } from '../../../src/lib/env';

export const metadata: Metadata = { title: 'Ayarlar' };

export default async function SettingsPage() {
  const [categories, orphanPaths] = await Promise.all([listCategories(), listOrphanUploads()]);
  const env = getServerEnv();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Yönetim</p>
          <h1>Ayarlar</h1>
          <p className="muted">Katalog kategorilerini ve tamamlanmamış yüklemeleri yönet.</p>
        </div>
      </header>
      <StaticCatalogPanel
        branch={env.catalogJsonBranch}
        configured={Boolean(env.catalogJsonRepo && env.catalogJsonToken)}
        path={env.catalogJsonPath}
        repo={env.catalogJsonRepo}
      />
      <CategoryManager categories={categories} />
      <OrphanPanel paths={orphanPaths} />
    </>
  );
}
