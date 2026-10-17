'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createBrowserSupabaseClient, getPublicAssetUrl } from '../../lib/supabase/browser';
import {
  addScreenshotAction,
  cleanupPublishingAssetAction,
  requestAssetUploadAction,
  setAppIconAction,
} from './asset-actions';

export function AssetManager({ appId, iconPath, screenshotCount }: Readonly<{
  appId: string;
  iconPath: string | null;
  screenshotCount: number;
}>) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);

  async function upload(
    file: File,
    kind: 'icon' | 'screenshot',
    altText = '',
    form?: HTMLFormElement,
  ) {
    const operationId = crypto.randomUUID();
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
    if (saved.ok) {
      form?.reset();
      if (kind === 'screenshot') setScreenshotFile(null);
      setMessage('Görsel yüklendi.');
      router.refresh();
    } else {
      await cleanupPublishingAssetAction({
        appId,
        operationId,
        path: intent.data.path,
        kind,
      });
      setMessage(saved.error.message);
    }
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
      {iconPath ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase project hosts are configured at runtime.
        <img
          alt="Mevcut uygulama ikonu"
          className="asset-icon-preview"
          height={96}
          src={getPublicAssetUrl(iconPath)}
          width={96}
        />
      ) : null}
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
            const element = event.currentTarget;
            const form = new FormData(element);
            const altText = String(form.get('altText') ?? '');
            if (screenshotFile && screenshotFile.size > 0) {
              void upload(screenshotFile, 'screenshot', altText, element);
            }
          }}
        >
          <label htmlFor="screenshot-file">Ekran görüntüsü</label>
          <input
            accept="image/png,image/jpeg,image/webp"
            disabled={pending}
            id="screenshot-file"
            name="screenshot"
            onChange={event => setScreenshotFile(event.currentTarget.files?.[0] ?? null)}
            required
            type="file"
          />
          <label htmlFor="screenshot-alt">Erişilebilir alt metin</label>
          <input autoComplete="off" id="screenshot-alt" maxLength={180} minLength={2} name="altText" required />
          <button className="secondary-button" disabled={pending} type="submit">Ekran görüntüsü ekle</button>
        </form>
      </div>
      {message ? <p aria-live="polite" className="muted" role="status">{message}</p> : null}
    </section>
  );
}
