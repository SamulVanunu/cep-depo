'use client';

import { useState } from 'react';

import type { StaticCatalogSkipReason } from './types';

type StaticCatalogFileEntry = Readonly<{ path: string; content: string }>;

type StaticCatalogLoadResponse = Readonly<{
  ok: true;
  data: Readonly<{
    generatedAt: string;
    appCount: number;
    categoryCount: number;
    skipped: readonly SkipEntry[];
    files: readonly StaticCatalogFileEntry[];
  }>;
}>;

type SkipEntry = Readonly<{
  id: string;
  slug: string;
  title: string;
  reason: StaticCatalogSkipReason;
  detail: string;
}>;

type PublishResponse = Readonly<{
  ok: true;
  data: Readonly<{
    commitSha: string;
    commitUrl: string;
    fileCount: number;
    deletedPaths: readonly string[];
    generatedAt: string;
    appCount: number;
    categoryCount: number;
    skipped: readonly SkipEntry[];
  }>;
}>;

type ErrorResponse = Readonly<{ ok: false; error: Readonly<{ message: string }> }>;

const reasonLabels: Readonly<Record<StaticCatalogSkipReason, string>> = {
  'app-inactive': 'Uygulama aktif değil',
  'category-missing': 'Kategori yok',
  'category-inactive': 'Kategori pasif',
  'no-published-version': 'Yayımlanmış sürüm yok',
  'invalid-app': 'Uygulama verisi geçersiz',
  'invalid-version': 'Sürüm verisi geçersiz',
};

function formatBytes(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function downloadFile(file: StaticCatalogFileEntry): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.path.split('/').pop() ?? 'catalog.json';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function StaticCatalogPanel({
  configured,
  repo,
  branch,
  path,
}: Readonly<{
  configured: boolean;
  repo: string | null;
  branch: string;
  path: string;
}>) {
  const [bundle, setBundle] = useState<StaticCatalogLoadResponse['data'] | null>(null);
  const [published, setPublished] = useState<PublishResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setPublished(null);
    try {
      const response = await fetch('/api/catalog/static-json', { credentials: 'same-origin' });
      const payload = (await response.json()) as StaticCatalogLoadResponse | ErrorResponse;
      if (!payload.ok) {
        setError(payload.error.message);
        setBundle(null);
        return;
      }
      setBundle(payload.data);
    } catch {
      setError('JSON hazırlanamadı.');
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    setPublished(null);
    try {
      const response = await fetch('/api/catalog/static-json', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const payload = (await response.json()) as PublishResponse | ErrorResponse;
      if (!payload.ok) {
        setError(payload.error.message);
        return;
      }
      setPublished(payload.data);
      setBundle(previous =>
        previous
          ? {
              ...previous,
              generatedAt: payload.data.generatedAt,
              appCount: payload.data.appCount,
              categoryCount: payload.data.categoryCount,
              skipped: payload.data.skipped,
            }
          : previous,
      );
    } catch {
      setError('GitHub aktarımı tamamlanamadı.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section aria-labelledby="static-catalog-heading" className="panel-section">
      <div className="section-heading">
        <div>
          <h2 id="static-catalog-heading">Statik katalog JSON</h2>
          <p className="muted">
            Anasayfa, kategoriler, hakkımızda ve uygulama içeriklerini JSON olarak üret.
            Yorumlar ve şikâyetler canlı veritabanında kalır.
          </p>
        </div>
        <div>
          <button className="secondary-button" disabled={loading || publishing} onClick={() => void load()} type="button">
            {loading ? 'Hazırlanıyor…' : 'JSON’u hazırla'}
          </button>
          <button
            className="primary-button"
            disabled={!configured || loading || publishing}
            onClick={() => void publish()}
            type="button"
          >
            {publishing ? 'Aktarılıyor…' : 'GitHub’a aktar'}
          </button>
        </div>
      </div>

      <p className="muted">
        {configured && repo
          ? `Hedef: ${repo} · ${branch} · ${path || 'kök'}`
          : 'GitHub aktarımı kapalı. CATALOG_JSON_REPO ve CATALOG_JSON_GITHUB_TOKEN tanımlandığında açılır.'}
      </p>

      {error ? <p className="inline-error" role="alert">{error}</p> : null}

      {published ? (
        <p role="status">
          {published.fileCount} dosya aktarıldı
          {published.deletedPaths.length > 0 ? `, ${published.deletedPaths.length} eski dosya silindi` : ''}.
          {' '}
          <a href={published.commitUrl} rel="noreferrer" target="_blank">Commit’i aç ↗</a>
        </p>
      ) : null}

      {bundle ? (
        <>
          <p className="muted">
            {new Date(bundle.generatedAt).toLocaleString('tr-TR')} · {bundle.appCount} uygulama ·{' '}
            {bundle.categoryCount} kategori · {bundle.files.length} dosya
          </p>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th scope="col">Dosya</th>
                  <th scope="col">Boyut</th>
                  <th scope="col">İndir</th>
                </tr>
              </thead>
              <tbody>
                {bundle.files.map(file => (
                  <tr key={file.path}>
                    <td><code>{file.path}</code></td>
                    <td>{formatBytes(file.content)}</td>
                    <td>
                      <button className="secondary-button" onClick={() => downloadFile(file)} type="button">
                        İndir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {bundle.skipped.length > 0 ? (
            <div className="danger-panel">
              <h3>Katalog dışında kalan uygulamalar</h3>
              <p className="muted">
                Bu uygulamalar JSON’a yazılmadı. Uygulama numarası veya slug ile eşleştirip nedenini giderin.
              </p>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Uygulama</th>
                      <th scope="col">Slug</th>
                      <th scope="col">Neden</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.skipped.map(skip => (
                      <tr key={`${skip.id}:${skip.reason}`}>
                        <td>{skip.title || '(başlıksız)'}</td>
                        <td><code>{skip.slug || '—'}</code></td>
                        <td>
                          {reasonLabels[skip.reason]}
                          <small>{skip.detail}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="muted">Katalog dışında kalan uygulama yok.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
