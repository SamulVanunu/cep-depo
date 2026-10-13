'use client';

import { useEffect, useRef, useState } from 'react';

import { cleanupOrphanUploadAction } from '../uploads/orphan-cleanup';
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
  hashFile: typeof hashFile;
  createUploadIntent: typeof createUploadIntentAction;
  startUpload(
    intent: TusIntent,
    file: File,
    callbacks: TusCallbacks,
  ): Promise<TusUploadHandle>;
  finalizeUpload: typeof finalizeUploadAction;
  cleanupOrphan: typeof cleanupOrphanUploadAction;
}>;

const defaultDependencies: ApkStepDependencies = {
  hashFile,
  createUploadIntent: createUploadIntentAction,
  startUpload: (intent, file, callbacks) => startTusUpload(intent, file, callbacks),
  finalizeUpload: finalizeUploadAction,
  cleanupOrphan: cleanupOrphanUploadAction,
};

type Progress = Readonly<{ percent: number; processed: number; total: number }>;

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function validateFile(file: File | null): string | null {
  if (!file || file.size === 0) return 'Geçerli bir APK dosyası seçmelisin.';
  if (!file.name.toLocaleLowerCase('tr-TR').endsWith('.apk')) return 'Dosya uzantısı .apk olmalıdır.';
  const mimeType = file.type || 'application/octet-stream';
  if (!APK_MIME_TYPES.includes(mimeType as (typeof APK_MIME_TYPES)[number])) {
    return 'Seçilen dosyanın APK türü doğrulanamadı.';
  }
  if (file.size > APK_MAX_BYTES) return 'APK dosyası 500 MiB sınırını aşamaz.';
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
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({ percent: 0, processed: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
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
    if (phase === 'error') errorRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!activeRef.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  function fail(errorMessage: string) {
    setPhase('error');
    setMessage(errorMessage);
  }

  async function run(form: HTMLFormElement) {
    if (activeRef.current) return;
    const selectedFile = file;
    const fileError = validateFile(selectedFile);
    if (fileError) {
      fail(fileError);
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

    activeRef.current = true;
    cancelledRef.current = false;
    orphanPathRef.current = null;
    setMessage(null);
    setProgress({ percent: 0, processed: 0, total: selectedFile.size });
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setPhase('hashing');
      const digest = await dependencies.hashFile(selectedFile, value => {
        setProgress({
          percent: Math.round(value * 100),
          processed: Math.round(selectedFile.size * value),
          total: selectedFile.size,
        });
      }, controller.signal);
      if (cancelledRef.current) return;

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
      });
    } catch (error) {
      if (!cancelledRef.current) {
        fail(error instanceof DOMException && error.name === 'AbortError'
          ? 'İşlem iptal edildi.'
          : 'APK işlenemedi. Lütfen yeniden dene.');
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
      : 'Sunucuda doğrulanıyor';

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
        <label className="field">
          <span>APK dosyası</span>
          <input
            accept=".apk,application/vnd.android.package-archive,application/octet-stream"
            aria-describedby={phase === 'error' ? 'apk-step-error' : undefined}
            disabled={active}
            name="apk"
            onChange={event => setFile(event.currentTarget.files?.[0] ?? null)}
            type="file"
          />
        </label>
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

        {!active && phase !== 'complete' ? (
          <button className="primary-button" type="submit">
            {phase === 'error' ? 'Tekrar dene' : 'APK dosyasını doğrula'}
          </button>
        ) : null}
      </form>
    </section>
  );
}
