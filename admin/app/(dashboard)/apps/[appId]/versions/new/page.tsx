import type { Metadata } from 'next';
import Link from 'next/link';

import { getApp } from '../../../../../../src/features/apps/app-dal';
import { OrphanPanel } from '../../../../../../src/features/uploads/orphan-panel';
import { listOrphanUploads } from '../../../../../../src/features/uploads/upload-dal';
import { UploadWizard } from '../../../../../../src/features/uploads/upload-wizard';

export const metadata: Metadata = { title: 'Yeni APK sürümü' };

export default async function NewVersionPage({ params }: Readonly<{ params: Promise<{ appId: string }> }>) {
  const { appId } = await params;
  const [app, orphans] = await Promise.all([getApp(appId), listOrphanUploads()]);
  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">APK yayınlama</p><h1>{app.title}</h1><p className="muted">Hash, resumable upload, doğrulama ve yayın özeti.</p></div>
        <Link href={`/apps/${appId}`}>Uygulamaya dön</Link>
      </header>
      <UploadWizard appId={appId} />
      <OrphanPanel paths={orphans} />
    </>
  );
}
