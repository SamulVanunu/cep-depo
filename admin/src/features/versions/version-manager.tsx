'use client';

import { useState, useTransition } from 'react';

import { publishVersionAction, withdrawVersionAction } from './version-actions';

type Version = Readonly<{
  id: string;
  version_name: string;
  version_code: number;
  status: 'draft' | 'published' | 'withdrawn';
  published_at: string | null;
}>;

export function VersionManager({ versions }: Readonly<{ versions: readonly Version[] }>) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section aria-labelledby="versions-heading" className="panel-section">
      <h2 id="versions-heading">Sürümler</h2>
      {versions.length ? (
        <ul className="version-list">
          {versions.toSorted((a, b) => b.version_code - a.version_code).map(version => (
            <li key={version.id}>
              <span><strong>{version.version_name}</strong> · Kod {version.version_code} · {version.status}</span>
              {version.status !== 'withdrawn' ? (
                <button
                  className={version.status === 'draft' ? 'primary-button' : 'danger-button'}
                  disabled={pending}
                  onClick={() => startTransition(async () => {
                    const result = version.status === 'draft'
                      ? await publishVersionAction(version.id)
                      : await withdrawVersionAction(version.id);
                    setMessage(result.ok ? 'Sürüm durumu güncellendi.' : result.error.message);
                  })}
                  type="button"
                >{version.status === 'draft' ? 'Yayımla' : 'Geri çek'}</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Henüz sürüm yok.</p>}
      {message ? <p aria-live="polite">{message}</p> : null}
    </section>
  );
}
