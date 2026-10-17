'use client';

import { useRef, useState } from 'react';

import type { ActionResult } from '../../server/errors/action-error';
import type { PublishingAppInput } from '../apps/app-schema';
import type { PublishingAppData } from '../apps/app-actions';
import type { SelectedPublishApp } from './publish-types';

type PublishingCategory = Readonly<{ id: string; name: string }>;

type UploadAssetInput = Readonly<{
  appId: string;
  operationId: string;
  kind: 'icon' | 'screenshot';
  file: File;
  altText: string;
  position: number;
}>;

export type AppStepProps = Readonly<{
  categories: readonly PublishingCategory[];
  selectedApp: SelectedPublishApp | null;
  createPublishingApp(input: PublishingAppInput): Promise<ActionResult<PublishingAppData>>;
  uploadAsset(input: UploadAssetInput): Promise<string>;
  compensateNewApp(input: Readonly<{ id: string; title: string; operationId: string }>): Promise<void>;
  onContinue(app: SelectedPublishApp): void;
}>;

function slugify(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function AppStep({
  categories,
  selectedApp,
  createPublishingApp,
  uploadAsset,
  compensateNewApp,
  onContinue,
}: AppStepProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [icon, setIcon] = useState<File | null>(null);
  const [screenshots, setScreenshots] = useState<readonly File[]>([]);
  const [altTexts, setAltTexts] = useState<readonly string[]>([]);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  function continueExisting() {
    if (!selectedApp || selectedApp.isNew || pending) return;
    try {
      onContinue(selectedApp);
    } catch {
      setError('APK adımına geçilemedi. Lütfen yeniden dene.');
    }
  }

  async function submit(form: HTMLFormElement) {
    if (pending) return;
    const data = new FormData(form);
    const input = {
      title: String(data.get('title') ?? '').trim(),
      slug: String(data.get('slug') ?? '').trim(),
      categoryId: String(data.get('categoryId') ?? ''),
      shortDescription: String(data.get('shortDescription') ?? '').trim(),
      description: String(data.get('description') ?? '').trim(),
      featured: data.get('featured') === 'on',
    };

    if (input.title.length < 2 || input.title.length > 90) {
      setError('Uygulama adı 2–90 karakter olmalıdır.');
      firstFieldRef.current?.focus();
      return;
    }
    if (!input.slug || input.slug.length > 120) {
      setError('Slug 1–120 karakter olmalıdır.');
      return;
    }
    if (!input.categoryId) {
      setError('Aktif bir kategori seçmelisin.');
      return;
    }
    if (input.shortDescription.length < 10 || input.shortDescription.length > 180) {
      setError('Kısa açıklama 10–180 karakter olmalıdır.');
      return;
    }
    if (input.description.length < 10 || input.description.length > 5000) {
      setError('Ayrıntılı açıklama 10–5000 karakter olmalıdır.');
      return;
    }
    if (!icon || icon.size === 0) {
      setError('Uygulama ikonu zorunludur.');
      return;
    }
    const invalidAlt = screenshots.findIndex((_, index) => {
      const length = (altTexts[index] ?? '').trim().length;
      return length < 2 || length > 180;
    });
    if (invalidAlt >= 0) {
      setError('Her ekran görüntüsü için 2–180 karakter alt metni girmelisin.');
      return;
    }

    setPending(true);
    setError(null);
    let staged: PublishingAppData | null = null;
    try {
      const result = await createPublishingApp(input);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      staged = result.data;
      const iconPath = await uploadAsset({
        appId: staged.id,
        operationId: staged.operationId,
        kind: 'icon',
        file: icon,
        altText: '',
        position: 0,
      });
      const uploadedScreenshots = [];
      for (const [position, file] of screenshots.entries()) {
        const altText = (altTexts[position] ?? '').trim();
        const path = await uploadAsset({
          appId: staged.id,
          operationId: staged.operationId,
          kind: 'screenshot',
          file,
          altText,
          position,
        });
        uploadedScreenshots.push({ path, altText, position });
      }
      onContinue({
        id: staged.id,
        title: input.title,
        slug: staged.slug,
        status: staged.status,
        iconPath,
        latestVersionCode: null,
        isNew: true,
        operationId: staged.operationId,
        initialAssets: { iconPath, screenshots: uploadedScreenshots },
      });
    } catch {
      if (staged) {
        try {
          await compensateNewApp({ id: staged.id, title: input.title, operationId: staged.operationId });
        } catch {
          // The permanent-delete action owns safe error reporting and durable cleanup.
        }
      }
      setError('Uygulama görselleri hazırlanamadı. Temizleme başlatıldı; yeniden deneyebilirsin.');
    } finally {
      setPending(false);
    }
  }

  if (selectedApp && !selectedApp.isNew) {
    return (
      <section aria-labelledby="app-step-heading" className="record-form">
        <div>
          <p className="eyebrow">1. adım</p>
          <h2 id="app-step-heading">{selectedApp.title}</h2>
          <p className="muted">Bu uygulama için yeni bir APK hazırlıyorsun.</p>
        </div>
        {error ? <p aria-live="assertive" role="alert">{error}</p> : null}
        <button className="primary-button" onClick={continueExisting} type="button">
          APK adımına devam et
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="app-step-heading" className="record-form">
      <div>
        <p className="eyebrow">1. adım</p>
        <h2 id="app-step-heading">Uygulama bilgileri</h2>
        <p className="muted">Katalog bilgilerini ve ilk görselleri eksiksiz hazırla.</p>
      </div>
      <form className="record-form" noValidate onSubmit={event => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}>
        <label className="field">
          <span>Uygulama adı</span>
          <input
            autoComplete="off"
            maxLength={90}
            name="title"
            onChange={event => {
              if (!slugEdited) setSlug(slugify(event.currentTarget.value));
            }}
            ref={firstFieldRef}
          />
        </label>
        <label className="field">
          <span>Slug</span>
          <input
            autoComplete="off"
            maxLength={120}
            name="slug"
            onChange={event => { setSlugEdited(true); setSlug(event.currentTarget.value); }}
            spellCheck={false}
            value={slug}
          />
        </label>
        <label className="field">
          <span>Kategori</span>
          <select defaultValue="" name="categoryId">
            <option disabled value="">Aktif kategori seç</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Kısa açıklama</span>
          <textarea maxLength={180} name="shortDescription" rows={3} />
        </label>
        <label className="field">
          <span>Ayrıntılı açıklama</span>
          <textarea maxLength={5000} name="description" rows={8} />
        </label>
        <label className="field checkbox-field">
          <input name="featured" type="checkbox" />
          <span>Öne çıkar</span>
        </label>
        <label className="field">
          <span>Uygulama ikonu</span>
          <input
            accept="image/png,image/jpeg,image/webp"
            name="icon"
            onChange={event => setIcon(event.currentTarget.files?.[0] ?? null)}
            type="file"
          />
        </label>
        <label className="field">
          <span>Ekran görüntüleri</span>
          <input
            accept="image/png,image/jpeg,image/webp"
            multiple
            name="screenshots"
            onChange={event => {
              const files = Array.from(event.currentTarget.files ?? []);
              setScreenshots(files);
              setAltTexts(files.map(() => ''));
            }}
            type="file"
          />
        </label>
        {screenshots.map((file, index) => (
          <label className="field" key={`${file.name}-${file.size}-${index}`}>
            <span>{file.name} alt metni</span>
            <input
              aria-label={`${file.name} alt metni`}
              maxLength={180}
              minLength={2}
              onChange={event => {
                const nextValue = event.currentTarget.value;
                setAltTexts(current => current.map((value, position) => (
                  position === index ? nextValue : value
                )));
              }}
              value={altTexts[index] ?? ''}
            />
          </label>
        ))}
        {error ? <p aria-live="assertive" role="alert">{error}</p> : null}
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Hazırlanıyor…' : 'APK adımına devam et'}
        </button>
      </form>
    </section>
  );
}
