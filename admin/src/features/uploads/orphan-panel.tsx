'use client';

import { useState, useTransition } from 'react';

import { cleanupOrphanUploadAction } from './orphan-cleanup';

export function OrphanPanel({ paths }: Readonly<{ paths: readonly string[] }>) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!paths.length) return null;
  return (
    <section aria-labelledby="orphans-heading" className="danger-panel">
      <h2 id="orphans-heading">Tamamlanmamış uploadlar</h2>
      <p className="muted">Yalnız bir sürüm taslağına bağlı olmayan, tanınan operation yolları gösterilir.</p>
      <ul className="orphan-list">
        {paths.map(path => (
          <li key={path}>
            <code>{path}</code>
            <button
              className="danger-button"
              disabled={pending}
              onClick={() => startTransition(async () => {
                const result = await cleanupOrphanUploadAction(path);
                setMessage(result.ok ? 'Upload temizlendi.' : result.error.message);
              })}
              type="button"
            >Temizle</button>
          </li>
        ))}
      </ul>
      {message ? <p aria-live="polite">{message}</p> : null}
    </section>
  );
}
