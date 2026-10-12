import type { Metadata } from 'next';
import Link from 'next/link';

import { AppForm } from '../../../../src/features/apps/app-form';
import { AppStatusPanel } from '../../../../src/features/apps/app-status-panel';
import { AssetManager } from '../../../../src/features/apps/asset-manager';
import { getApp, listCategories } from '../../../../src/features/apps/app-dal';
import { StatusBadge } from '../../../../src/components/status/status-badge';
import { ScreenshotList } from '../../../../src/features/apps/screenshot-list';
import { VersionManager } from '../../../../src/features/versions/version-manager';

export const metadata: Metadata = { title: 'Uygulama detayı' };

export default async function AppDetailPage({
  params,
}: Readonly<{ params: Promise<{ appId: string }> }>) {
  const { appId } = await params;
  const [app, categories] = await Promise.all([getApp(appId), listCategories()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Katalog kaydı</p>
          <h1>{app.title}</h1>
          <p className="muted">{app.slug}</p>
        </div>
        <div className="header-actions">
          <StatusBadge tone={app.status === 'active' ? 'success' : 'neutral'}>
            {app.status === 'active' ? 'Aktif' : 'Arşiv'}
          </StatusBadge>
          <Link href="/apps">Listeye dön</Link>
          <Link className="primary-button" href={`/publish?appId=${encodeURIComponent(app.id)}`}>Yeni APK yükle</Link>
        </div>
      </header>

      <AppForm app={app} categories={categories} />
      <AssetManager appId={app.id} screenshotCount={app.app_screenshots.length} />
      <VersionManager versions={app.app_versions} />

      <section aria-labelledby="screenshots-heading" className="panel-section">
        <h2 id="screenshots-heading">Ekran görüntüleri</h2>
        <ScreenshotList appId={app.id} screenshots={app.app_screenshots} />
      </section>

      <AppStatusPanel appId={app.id} status={app.status} />
    </>
  );
}
