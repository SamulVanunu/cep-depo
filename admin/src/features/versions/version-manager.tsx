'use client';

type Version = Readonly<{
  id: string;
  version_name: string;
  version_code: number;
  status: 'draft' | 'published' | 'withdrawn';
  package_name?: string | null;
  download_source?: 'storage' | 'external';
  published_at: string | null;
}>;

export function VersionManager({ versions }: Readonly<{ versions: readonly Version[] }>) {
  const currentVersions = versions
    .toSorted((a, b) => b.version_code - a.version_code);

  return (
    <section aria-labelledby="versions-heading" className="panel-section">
      {currentVersions.length ? (
        <ul className="version-list">
          {currentVersions.map(version => (
            <li key={version.id}>
              <span>
                <strong>{version.version_name}</strong> · Kod {version.version_code} · {version.status}
                {version.package_name ? <> · Paket {version.package_name}</> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="muted">Henüz sürüm yok.</p>}
    </section>
  );
}
