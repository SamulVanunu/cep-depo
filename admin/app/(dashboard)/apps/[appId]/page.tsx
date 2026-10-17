import type { Metadata } from 'next';
import Link from 'next/link';

import { AppDeletePanel } from '../../../../src/features/apps/app-delete-panel';
import { AppForm } from '../../../../src/features/apps/app-form';
import { AppStatusPanel } from '../../../../src/features/apps/app-status-panel';
import { AssetManager } from '../../../../src/features/apps/asset-manager';
import { getApp, listCategories } from '../../../../src/features/apps/app-dal';
import { StatusBadge } from '../../../../src/components/status/status-badge';
import { ScreenshotList } from '../../../../src/features/apps/screenshot-list';
import { VersionManager } from '../../../../src/features/versions/version-manager';

export const metadata: Metadata = { title: 'Uygulama yönetimi' };

export default async function AppDetailPage({
  params,
}: Readonly<{ params: Promise<{ appId: string }> }>) {
  const { appId } = await params;
  const [app, categories] = await Promise.all([getApp(appId), listCategories()]);

  const editableApp = {
    id: app.id,
    category_id: app.category_id,
    slug: app.slug,
    title: app.title,
    short_description: app.short_description,
    description: app.description,
    featured: app.featured,
    status: app.status,
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Uygulama yönetimi</p>
          <h1>{app.title}</h1>
          <p className="muted">{app.slug}</p>
        </div>
        <div className="header-actions">
          <StatusBadge tone={app.status === 'active' ? 'success' : 'neutral'}>
            {app.status === 'active' ? 'Aktif' : 'Arşiv'}
          </StatusBadge>
          <Link href="/apps">Listeye dön</Link>
          <Link href="#application-details">Bilgileri düzenle</Link>
          <Link className="primary-button" href={`/publish?appId=${encodeURIComponent(app.id)}`}>Yeni APK ile güncelle</Link>
        </div>
      </header>

      <section id="application-details" aria-labelledby="application-details-heading" className="panel-section">
        <h2 id="application-details-heading">Bilgileri düzenle</h2>
        <AppForm app={editableApp} categories={categories} />
      </section>

      <section aria-labelledby="assets-heading" className="panel-section">
        <h2 id="assets-heading">Varlıklar</h2>
        <AssetManager appId={app.id} iconPath={app.icon_path} screenshotCount={app.app_screenshots.length} />
      </section>

      <section aria-labelledby="versions-heading" className="panel-section">
        <h2 id="versions-heading">Güncel sürüm</h2>
        <VersionManager versions={app.app_versions} />
      </section>

      <section aria-labelledby="screenshots-heading" className="panel-section">
        <h2 id="screenshots-heading">Ekran görüntüleri</h2>
        <ScreenshotList appId={app.id} screenshots={app.app_screenshots} />
      </section>

      <AppStatusPanel appId={app.id} status={app.status} />

      <AppDeletePanel appId={app.id} title={app.title} />
    </>
  );
}
