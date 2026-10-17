import type { Metadata } from 'next';

import { listCategories, listPublishApps } from '../../../src/features/apps/app-dal';
import { resolvePreselectedApp } from '../../../src/features/publishing/publish-selection';
import { PublishWizard } from '../../../src/features/publishing/publish-wizard';

export const metadata: Metadata = { title: 'APK yayınla' };

export default async function PublishPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ appId?: string | string[] }>;
}>) {
  const [apps, categories, query] = await Promise.all([listPublishApps(), listCategories(), searchParams]);
  const rawAppId = typeof query.appId === 'string' ? query.appId : query.appId === undefined ? undefined : '';
  const selection = resolvePreselectedApp(rawAppId, apps);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">APK yayınlama</p>
          <h1>Uygulama yayınla</h1>
          <p className="muted">Uygulamayı seç, APK dosyasını doğrula ve son kontrolden sonra yayınla.</p>
        </div>
      </header>
      <PublishWizard
        categories={categories.filter(category => category.isActive)}
        initialApp={selection.app}
        initialSelectionInvalid={selection.invalid}
      />
    </>
  );
}
