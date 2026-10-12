'use client';

import { useMemo, useRef, useState } from 'react';

import type { ActionResult } from '../../server/errors/action-error';
import type { PublishAppOption } from '../apps/publish-app-options';
import type { SelectedPublishApp } from './publish-types';

type QuickAppResult = ActionResult<Readonly<{
  id: string;
  slug: string;
  status: 'archived';
}>>;

type AppStepProps = Readonly<{
  apps: readonly PublishAppOption[];
  selectedApp: SelectedPublishApp | null;
  createQuickApp(input: Readonly<{ title: string; shortDescription: string }>): Promise<QuickAppResult>;
  uploadIcon(appId: string, file: File): Promise<void>;
  onContinue(app: SelectedPublishApp): void;
}>;

export function AppStep({ apps, selectedApp, createQuickApp, uploadIcon, onContinue }: AppStepProps) {
  const [mode, setMode] = useState<'existing' | 'new'>(selectedApp?.isNew ? 'new' : 'existing');
  const [query, setQuery] = useState('');
  const [currentApp, setCurrentApp] = useState(selectedApp);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<File | null>(null);
  const [iconRetry, setIconRetry] = useState<Readonly<{ app: SelectedPublishApp; file: File }> | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const filteredApps = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    if (!normalized) return apps;
    return apps.filter(app => (
      app.title.toLocaleLowerCase('tr-TR').includes(normalized)
      || app.slug.toLocaleLowerCase('tr-TR').includes(normalized)
    ));
  }, [apps, query]);

  async function retryIcon() {
    if (!iconRetry || pending) return;
    setPending(true);
    setError(null);
    try {
      await uploadIcon(iconRetry.app.id, iconRetry.file);
      setIconRetry(null);
      onContinue(iconRetry.app);
    } catch {
      setError('İkon yüklenemedi. Dosyayı kontrol edip yeniden deneyebilirsin.');
    } finally {
      setPending(false);
    }
  }

  async function create(form: HTMLFormElement) {
    if (pending) return;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    const shortDescription = String(data.get('shortDescription') ?? '').trim();

    if (title.length < 2 || title.length > 90) {
      setError('Uygulama adı 2–90 karakter olmalıdır.');
      titleRef.current?.focus();
      return;
    }
    if (shortDescription.length < 10 || shortDescription.length > 180) {
      setError('Kısa açıklama 10–180 karakter olmalıdır.');
      descriptionRef.current?.focus();
      return;
    }

    setPending(true);
    setError(null);
    const result = await createQuickApp({ title, shortDescription });
    if (!result.ok) {
      setError(result.error.message);
      setPending(false);
      return;
    }

    const createdApp: SelectedPublishApp = {
      id: result.data.id,
      title,
      slug: result.data.slug,
      status: result.data.status,
      iconPath: null,
      latestVersionCode: null,
      isNew: true,
    };
    setCurrentApp(createdApp);

    if (selectedIcon && selectedIcon.size > 0) {
      try {
        await uploadIcon(createdApp.id, selectedIcon);
      } catch {
        setIconRetry({ app: createdApp, file: selectedIcon });
        setError('İkon yüklenemedi. Uygulama korundu; ikonu tekrar yükleyebilirsin.');
        setPending(false);
        return;
      }
    }

    setPending(false);
    onContinue(createdApp);
  }

  return (
    <section aria-labelledby="app-step-heading" className="record-form">
      <div>
        <p className="eyebrow">1. adım</p>
        <h2 id="app-step-heading">Uygulamayı seç</h2>
        <p className="muted">Mevcut bir uygulamaya sürüm ekle veya temel bilgilerle yenisini oluştur.</p>
      </div>

      <div aria-label="Uygulama kaynağı" className="button-row" role="group">
        <button
          aria-pressed={mode === 'existing'}
          className="secondary-button"
          onClick={() => { setMode('existing'); setError(null); }}
          type="button"
        >
          Mevcut uygulama
        </button>
        <button
          aria-pressed={mode === 'new'}
          className="secondary-button"
          onClick={() => { setMode('new'); setError(null); }}
          type="button"
        >
          Yeni uygulama oluştur
        </button>
      </div>

      {mode === 'existing' ? (
        <fieldset className="record-form">
          <legend className="sr-only">Mevcut uygulama seçimi</legend>
          <label className="field">
            <span>Uygulama ara</span>
            <input
              aria-label="Uygulama ara"
              autoComplete="off"
              name="appQuery"
              onChange={event => setQuery(event.currentTarget.value)}
              placeholder="Ad veya slug…"
              spellCheck={false}
              type="search"
              value={query}
            />
          </label>
          <div className="app-selection-list">
            {filteredApps.map(app => (
              <button
                aria-pressed={currentApp?.id === app.id}
                className="secondary-button"
                key={app.id}
                onClick={() => setCurrentApp({ ...app, isNew: false })}
                type="button"
              >
                <strong>{app.title}</strong>
                <span>{app.latestVersionCode === null ? 'Henüz sürüm yok' : `Son sürüm kodu: ${app.latestVersionCode}`}</span>
              </button>
            ))}
          </div>
          <button
            className="primary-button"
            disabled={!currentApp}
            onClick={() => { if (currentApp) onContinue(currentApp); }}
            type="button"
          >
            APK adımına devam et
          </button>
        </fieldset>
      ) : (
        <form
          className="record-form"
          noValidate
          onSubmit={event => {
            event.preventDefault();
            void create(event.currentTarget).catch(() => {
              setPending(false);
              setError('Uygulama oluşturulamadı. Lütfen yeniden dene.');
            });
          }}
        >
          <label className="field">
            <span>Uygulama adı</span>
            <input aria-describedby={error ? 'app-step-error' : undefined} autoComplete="off" maxLength={90} name="title" ref={titleRef} />
          </label>
          <label className="field">
            <span>Kısa açıklama</span>
            <textarea
              aria-describedby={error ? 'app-step-error' : undefined}
              autoComplete="off"
              maxLength={180}
              name="shortDescription"
              ref={descriptionRef}
              rows={4}
            />
          </label>
          <label className="field">
            <span>Uygulama ikonu (isteğe bağlı)</span>
            <input
              accept="image/png,image/jpeg,image/webp"
              aria-label="Uygulama ikonu"
              name="icon"
              onChange={event => setSelectedIcon(event.currentTarget.files?.[0] ?? null)}
              type="file"
            />
          </label>
          {error ? <p aria-live="assertive" id="app-step-error" role="alert">{error}</p> : null}
          {iconRetry ? (
            <button className="secondary-button" disabled={pending} onClick={() => void retryIcon()} type="button">
              İkonu tekrar yükle
            </button>
          ) : (
            <button className="primary-button" disabled={pending} type="submit">
              {pending ? 'Oluşturuluyor…' : 'Uygulamayı oluştur'}
            </button>
          )}
        </form>
      )}
    </section>
  );
}
