'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { getPublicAssetUrl } from '../../lib/supabase/browser';
import {
  deleteScreenshotAction,
  updateScreenshotAction,
} from './asset-actions';

type Screenshot = Readonly<{
  id: string;
  alt_text: string;
  position: number;
  path: string;
}>;

export function ScreenshotList({ appId, screenshots }: Readonly<{
  appId: string;
  screenshots: readonly Screenshot[];
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!screenshots.length) return <p className="muted">Henüz ekran görüntüsü eklenmedi.</p>;

  return (
    <ol className="asset-list">
      {screenshots.toSorted((left, right) => left.position - right.position).map(screenshot => (
        <li key={screenshot.id}>
          <form
            className="screenshot-row"
            onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await updateScreenshotAction({
                  appId,
                  screenshotId: screenshot.id,
                  altText: String(data.get('altText') ?? ''),
                  position: Number(data.get('position')),
                });
                setMessage(result.ok ? 'Ekran görüntüsü güncellendi.' : result.error.message);
                if (result.ok) router.refresh();
              });
            }}
          >
            <label className="field">
              <span>Alt metin</span>
              <input defaultValue={screenshot.alt_text} maxLength={180} minLength={2} name="altText" required />
            </label>
            <label className="field">
              <span>Sıra</span>
              <input defaultValue={screenshot.position} min={0} name="position" type="number" />
            </label>
            <button className="secondary-button" disabled={pending} type="submit">Güncelle</button>
            <button
              className="danger-button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteScreenshotAction(appId, screenshot.id);
                  setMessage(result.ok ? 'Ekran görüntüsü kaydı silindi.' : result.error.message);
                  if (result.ok) router.refresh();
                });
              }}
              type="button"
            >
              Sil
            </button>
          </form>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase project hosts are configured at runtime. */}
          <img
            alt={screenshot.alt_text}
            className="asset-screenshot-preview"
            height={90}
            loading="lazy"
            src={getPublicAssetUrl(screenshot.path)}
            width={160}
          />
          <code>{screenshot.path}</code>
        </li>
      ))}
      {message ? <li aria-live="polite" className="muted" role="status">{message}</li> : null}
    </ol>
  );
}
