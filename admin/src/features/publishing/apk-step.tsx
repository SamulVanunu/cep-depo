'use client';

import { useEffect, useRef, useState } from 'react';

import { cleanupOrphanUploadAction } from '../uploads/orphan-cleanup';
import { createExternalDraftAction } from '../uploads/external-draft-actions';
import {
  HOSTED_STORAGE_MAX_BYTES,
  parseExternalApkUrl,
  verifyLocalApkMagic,
} from '../uploads/external-apk';
import { hashFile } from '../uploads/hash-file';
import {
  startTusUpload,
  type TusCallbacks,
  type TusIntent,
  type TusUploadHandle,
} from '../uploads/tus-upload';
import { createUploadIntentAction, finalizeUploadAction } from '../uploads/upload-actions';
import { APK_MAX_BYTES, APK_MIME_TYPES } from '../uploads/upload-schema';
import type { PublishReview, SelectedPublishApp } from './publish-types';

export type UploadPhase = 'idle' | 'hashing' | 'uploading' | 'finalizing' | 'error' | 'complete';

export type ApkStepDependencies = Readonly<{
  verifyLocalApkMagic: typeof verifyLocalApkMagic;
  hashFile: typeof hashFile;
  createUploadIntent: typeof createUploadIntentAction;
  startUpload(
    intent: TusIntent,
    file: File,
    callbacks: TusCallbacks,
  ): Promise<TusUploadHandle>;
  finalizeUpload: typeof finalizeUploadAction;
  createExternalDraft: typeof createExternalDraftAction;
  cleanupOrphan: typeof cleanupOrphanUploadAction;
}>;

const defaultDependencies: ApkStepDependencies = {
  verifyLocalApkMagic,
  hashFile,
  createUploadIntent: createUploadIntentAction,
  startUpload: (intent, file, callbacks) => startTusUpload(intent, file, callbacks),
  finalizeUpload: finalizeUploadAction,
  createExternalDraft: createExternalDraftAction,
  cleanupOrphan: cleanupOrphanUploadAction,
};

type Progress = Readonly<{ percent: number; processed: number; total: number }>;
type SourceMode = 'storage' | 'external';

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function validateFile(file: File | null, source: SourceMode): string | null {
  if (!file || file.size === 0) {
    return source === 'external'
      ? 'Önce bağlantıdaki APK’nın aynı yerel kopyasını seç.'
      : 'Geçerli bir APK dosyası seçmelisin.';
  }
  if (!file.name.toLocaleLowerCase('tr-TR').endsWith('.apk')) return 'Dosya uzantısı .apk olmalıdır.';
  const mimeType = file.type || 'application/octet-stream';
  if (!APK_MIME_TYPES.includes(mimeType as (typeof APK_MIME_TYPES)[number])) {
    return 'Seçilen dosyanın APK türü doğrulanamadı.';
  }
  if (file.size > APK_MAX_BYTES) return 'APK dosyası 500 MiB sınırını aşamaz.';
  if (source === 'storage' && file.size > HOSTED_STORAGE_MAX_BYTES) {
    return 'Supabase Storage bu planda 50.000.000 bayt üzerindeki APK dosyalarını kabul etmez.';
  }
  return null;
}

export function ApkStep({
  app,
  onComplete,
  dependencies = defaultDependencies,
}: Readonly<{
  app: SelectedPublishApp;
  onComplete(review: PublishReview): void;
  dependencies?: ApkStepDependencies;
}>) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [source, setSource] = useState<SourceMode>('storage');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({ percent: 0, processed: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const focusFileOnErrorRef = useRef(false);
  const activeRef = useRef(false);
  const cancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadHandleRef = useRef<Promise<TusUploadHandle> | null>(null);
  const settleUploadRef = useRef<(() => void) | null>(null);
  const orphanPathRef = useRef<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (phase !== 'error') return;
    if (focusFileOnErrorRef.current) {
      focusFileOnErrorRef.current = false;
      fileInputRef.current?.focus();
      return;
    }
    errorRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!activeRef.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  function fail(errorMessage: string, focusFile = false) {
    focusFileOnErrorRef.current = focusFile;
    setPhase('error');
    setMessage(errorMessage);
  }

  async function run(form: HTMLFormElement) {
    if (activeRef.current) return;
    const selectedFile = file;
    const fileError = validateFile(selectedFile, source);
    if (fileError) {
      fail(fileError, !selectedFile || selectedFile.size === 0);
      return;
    }
    if (!selectedFile) return;

    const data = new FormData(form);
    const versionName = String(data.get('versionName') ?? '').trim();
    const versionCode = Number(data.get('versionCode'));
    const changelog = String(data.get('changelog') ?? '').trim();
    if (!versionName || versionName.length > 40 || !Number.isInteger(versionCode) || versionCode <= 0) {
      fail('Sürüm adı ve pozitif tam sayı sürüm kodu girmelisin.');
      return;
    }

    let externalUrl: Readonly<{ url: string; hostname: string }> | null = null;
    if (source === 'external') {
      try {
        externalUrl = parseExternalApkUrl(String(data.get('apkUrl') ?? ''));
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Geçerli bir herkese açık HTTPS APK bağlantısı gir.');
        return;
      }
    }

    activeRef.current = true;
    cancelledRef.current = false;
    orphanPathRef.current = null;
    setMessage(null);
    setProgress({ percent: 0, processed: 0, total: selectedFile.size });
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setPhase('hashing');
      if (source === 'external') {
        await dependencies.verifyLocalApkMagic(selectedFile);
        if (cancelledRef.current) return;
      }
      const digest = await dependencies.hashFile(selectedFile, value => {
        setProgress({
          percent: Math.round(value * 100),
          processed: Math.round(selectedFile.size * value),
          total: selectedFile.size,
        });
      }, controller.signal);
      if (cancelledRef.current) return;

      if (source === 'external' && externalUrl) {
        setPhase('finalizing');
        const drafted = await dependencies.createExternalDraft({
          appId: app.id,
          fileName: selectedFile.name,
          versionName,
          versionCode,
          changelog,
          apkUrl: externalUrl.url,
          size: selectedFile.size,
          sha256: digest,
        });
        if (!drafted.ok) {
          fail(drafted.error.message);
          return;
        }
        setPhase('complete');
        onComplete({
          app,
          versionId: drafted.data.id,
          versionName,
          versionCode,
          fileName: selectedFile.name,
          size: selectedFile.size,
          sha256: digest,
          changelog,
          source: { kind: 'external', hostname: drafted.data.hostname },
        });
        return;
      }

      const mimeType = selectedFile.type || 'application/octet-stream';
      const intent = await dependencies.createUploadIntent({
        appId: app.id,
        fileName: selectedFile.name,
        mimeType,
        size: selectedFile.size,
      });
      if (!intent.ok) {
        fail(intent.error.message);
        return;
      }
      orphanPathRef.current = intent.data.path;
      setPhase('uploading');
      setProgress({ percent: 0, processed: 0, total: selectedFile.size });

      await new Promise<void>((resolve, reject) => {
        settleUploadRef.current = resolve;
        uploadHandleRef.current = dependencies.startUpload(
          { ...intent.data, mimeType },
          selectedFile,
          {
            onProgress: (uploaded, total) => setProgress({
              percent: total > 0 ? Math.round((uploaded / total) * 100) : 0,
              processed: uploaded,
              total,
            }),
            onError: reject,
            onSuccess: resolve,
          },
        );
        void uploadHandleRef.current.catch(reject);
      });
      if (cancelledRef.current) return;

      setPhase('finalizing');
      setProgress({ percent: 100, processed: selectedFile.size, total: selectedFile.size });
      const finalized = await dependencies.finalizeUpload({
        appId: app.id,
        operationId: intent.data.operationId,
        versionName,
        versionCode,
        changelog,
        size: selectedFile.size,
        sha256: digest,
      });
      if (!finalized.ok) {
        fail(finalized.error.message);
        return;
      }

      setPhase('complete');
      onComplete({
        app,
        versionId: finalized.data.id,
        versionName,
        versionCode,
        fileName: selectedFile.name,
        size: selectedFile.size,
        sha256: digest,
        changelog,
        source: { kind: 'storage' },
      });
    } catch (error) {
      if (!cancelledRef.current) {
        const safeMessage = error instanceof Error && [
          'Seçilen dosya geçerli bir APK değil.',
          'Geçerli bir herkese açık HTTPS APK bağlantısı gir.',
        ].includes(error.message)
          ? error.message
          : 'APK işlenemedi. Lütfen yeniden dene.';
        fail(error instanceof DOMException && error.name === 'AbortError' ? 'İşlem iptal edildi.' : safeMessage);
      }
    } finally {
      activeRef.current = false;
      abortControllerRef.current = null;
      uploadHandleRef.current = null;
      settleUploadRef.current = null;
    }
  }

  async function cancel() {
    if (!activeRef.current || cancelledRef.current) return;
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    const handlePromise = uploadHandleRef.current;
    if (handlePromise) {
      try {
        const handle = await handlePromise;
        await handle.abort(true);
      } catch {
        // The upload may already have failed; orphan cleanup still runs below.
      }
    }
    const path = orphanPathRef.current;
    if (path) await dependencies.cleanupOrphan(path).catch(() => undefined);
    settleUploadRef.current?.();
    settleUploadRef.current = null;
    activeRef.current = false;
    setPhase('idle');
    setMessage('İşlem iptal edildi.');
  }

  const active = phase === 'hashing' || phase === 'uploading' || phase === 'finalizing';
  const phaseLabel = phase === 'hashing'
    ? 'Dosya doğrulanıyor'
    : phase === 'uploading'
      ? 'APK yükleniyor'
      : source === 'external'
        ? 'Harici APK taslağı oluşturuluyor'
        : 'Sunucuda doğrulanıyor';
  const storageFileTooLarge = source === 'storage' && Boolean(file && file.size > HOSTED_STORAGE_MAX_BYTES);

  return (
    <section aria-labelledby="apk-step-heading" className="record-form">
      <div>
        <p className="eyebrow">2. adım</p>
        <h2 id="apk-step-heading" ref={headingRef} tabIndex={-1}>APK bilgileri</h2>
        <p className="muted">{app.title} için APK dosyasını güvenli biçimde doğrula.</p>
      </div>
      <form
        className="record-form"
        noValidate
        onSubmit={event => {
          event.preventDefault();
          void run(event.currentTarget);
        }}
      >
        <fieldset disabled={active}>
          <legend>APK kaynağı</legend>
          <label>
            <input
              checked={source === 'storage'}
              name="apkSource"
              onChange={() => {
                setSource('storage');
                setPhase('idle');
                setMessage(null);
              }}
              type="radio"
              value="storage"
            />
            APK dosyası yükle
          </label>
          <label>
            <input
              checked={source === 'external'}
              name="apkSource"
              onChange={() => {
                setSource('external');
                setPhase('idle');
                setMessage(null);
              }}
              type="radio"
              value="external"
            />
            HTTPS APK linki kullan
          </label>
        </fieldset>
        {source === 'external' ? (
          <>
            <div className="muted">
              <strong>Bu yöntem iki bilgi gerektirir:</strong>{' '}
              aynı APK’nın yerel kopyası ve public doğrudan indirme bağlantısı.
            </div>
            <div className="field">
              <label htmlFor="external-local-apk">1. Aynı APK’nın yerel kopyası</label>
              <input
                accept=".apk,application/vnd.android.package-archive,application/octet-stream"
                aria-describedby={phase === 'error'
                  ? 'external-local-apk-help apk-step-error'
                  : 'external-local-apk-help'}
                disabled={active}
                id="external-local-apk"
                name="apk"
                onChange={event => setFile(event.currentTarget.files?.[0] ?? null)}
                ref={fileInputRef}
                type="file"
              />
              <small id="external-local-apk-help">
                Bu dosya sunucuya yüklenmez; boyut, APK biçimi ve SHA-256 doğrulaması için kullanılır.
              </small>
            </div>
            <div className="field">
              <label htmlFor="external-apk-url">2. Doğrudan HTTPS APK bağlantısı</label>
              <input
                aria-describedby={phase === 'error' ? 'apk-step-error' : 'external-apk-help'}
                autoComplete="url"
                disabled={active}
                id="external-apk-url"
                name="apkUrl"
                placeholder="https://downloads.example.com/releases/app.apk"
                type="url"
              />
              <small id="external-apk-help">Kimlik bilgisi, sorgu parametresi ve yönlendirme sayfası kullanma.</small>
            </div>
          </>
        ) : (
          <label className="field">
            <span>APK dosyası</span>
            <input
              accept=".apk,application/vnd.android.package-archive,application/octet-stream"
              aria-describedby={phase === 'error' ? 'apk-step-error' : undefined}
              disabled={active}
              name="apk"
              onChange={event => setFile(event.currentTarget.files?.[0] ?? null)}
              ref={fileInputRef}
              type="file"
            />
          </label>
        )}
        <label className="field"><span>Sürüm adı</span><input autoComplete="off" disabled={active} maxLength={40} name="versionName" /></label>
        <label className="field"><span>Sürüm kodu</span><input autoComplete="off" disabled={active} inputMode="numeric" min={1} name="versionCode" type="number" /></label>
        <label className="field"><span>Değişiklik notları</span><textarea autoComplete="off" disabled={active} maxLength={5000} name="changelog" rows={5} /></label>

        {active ? (
          <div className="upload-progress">
            <progress
              aria-label={phaseLabel}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress.percent}
              max={100}
              value={progress.percent}
            />
            <p aria-live="polite" role="status">
              {phaseLabel}: %{progress.percent} ({formatMiB(progress.processed)} / {formatMiB(progress.total)})
            </p>
            <button className="secondary-button" onClick={() => void cancel()} type="button">İptal</button>
          </div>
        ) : null}

        {message ? (
          <p
            aria-live={phase === 'error' ? 'assertive' : 'polite'}
            id={phase === 'error' ? 'apk-step-error' : undefined}
            ref={errorRef}
            role={phase === 'error' ? 'alert' : 'status'}
            tabIndex={phase === 'error' ? -1 : undefined}
          >
            {message}
          </p>
        ) : null}

        {storageFileTooLarge && phase === 'error' ? (
          <button
            className="secondary-button"
            onClick={() => {
              setSource('external');
              setPhase('idle');
              setMessage(null);
            }}
            type="button"
          >
            HTTPS linki kullan
          </button>
        ) : null}

        {!active && phase !== 'complete' ? (
          <button className="primary-button" type="submit">
            {phase === 'error'
              ? 'Tekrar dene'
              : source === 'external'
                ? 'Harici APK bilgilerini doğrula'
                : 'APK dosyasını doğrula'}
          </button>
        ) : null}
      </form>
    </section>
  );
}
