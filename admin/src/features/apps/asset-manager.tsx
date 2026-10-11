'use client';

import { useState } from 'react';

import { createBrowserSupabaseClient } from '../../lib/supabase/browser';
import {
  addScreenshotAction,
  requestAssetUploadAction,
  setAppIconAction,
} from './asset-actions';

export function AssetManager({ appId, screenshotCount }: Readonly<{
  appId: string;
  screenshotCount: number;
}>) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function upload(file: File, kind: 'icon' | 'screenshot', altText = '') {
    setPending(true);
    setMessage(null);
    const intent = await requestAssetUploadAction({
      appId,
      kind,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
    if (!intent.ok) {
      setMessage(intent.error.message);
      setPending(false);
      return;
    }

    const client = createBrowserSupabaseClient();
    const uploaded = await client.storage
      .from(intent.data.bucket)
      .uploadToSignedUrl(intent.data.path, intent.data.token, file, { contentType: file.type });
    if (uploaded.error) {
      setMessage('Dosya yüklenemedi. Lütfen yeniden dene.');
      setPending(false);
      return;
    }

    const saved = kind === 'icon'
      ? await setAppIconAction(appId, intent.data.path)
      : await addScreenshotAction({
          appId,
          path: intent.data.path,
          altText,
          position: screenshotCount,
        });
    setMessage(saved.ok ? 'Görsel yüklendi.' : saved.error.message);
    setPending(false);
  }

  return (
    <section aria-labelledby="assets-heading" className="panel-section">
      <div className="section-heading">
        <div>
          <h2 id="assets-heading">Görseller</h2>
          <p className="muted">PNG, JPEG veya WebP; en fazla 10 MiB.</p>
        </div>
      </div>
      <div className="asset-grid">
        <label className="field">
          <span>Uygulama ikonu</span>
          <input
            accept="image/png,image/jpeg,image/webp"
            disabled={pending}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file, 'icon');
            }}
            type="file"
          />
        </label>
        <form
          className="field"
          onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const file = form.get('screenshot');
            const altText = String(form.get('altText') ?? '');
            if (file instanceof File && file.size > 0) void upload(file, 'screenshot', altText);
          }}
        >
          <span>Ekran görüntüsü</span>
          <input accept="image/png,image/jpeg,image/webp" disabled={pending} name="screenshot" required type="file" />
          <input maxLength={180} minLength={2} name="altText" placeholder="Erişilebilir alt metin" required />
          <button className="secondary-button" disabled={pending} type="submit">Ekran görüntüsü ekle</button>
        </form>
      </div>
      {message ? <p aria-live="polite" className="muted">{message}</p> : null}
    </section>
  );
}
