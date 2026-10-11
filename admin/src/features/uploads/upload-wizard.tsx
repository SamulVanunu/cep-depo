'use client';

import { useEffect, useState } from 'react';

import { hashFile } from './hash-file';
import { startTusUpload } from './tus-upload';
import { finalizeUploadAction } from './upload-actions';

type Step = 'metadata' | 'hash' | 'upload' | 'review';

export function UploadWizard({ appId }: Readonly<{ appId: string }>) {
  const [step, setStep] = useState<Step>('metadata');
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!active) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  async function run(form: HTMLFormElement) {
    const data = new FormData(form);
    const file = data.get('apk');
    if (!(file instanceof File) || file.size === 0) return;
    setActive(true);
    setStep('hash');
    const sha256 = await hashFile(file, value => setProgress(Math.round(value * 100)));
    const mimeType = file.type || 'application/octet-stream';
    const response = await fetch('/api/uploads/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, fileName: file.name, mimeType, size: file.size }),
    });
    const intent = await response.json();
    if (!intent.ok) {
      setMessage(intent.error.message);
      setActive(false);
      return;
    }
    setStep('upload');
    await new Promise<void>((resolve, reject) => {
      void startTusUpload(
        { ...intent.data, mimeType },
        file,
        {
          onProgress: (uploaded, total) => setProgress(Math.round((uploaded / total) * 100)),
          onError: reject,
          onSuccess: resolve,
        },
      );
    });
    const finalized = await finalizeUploadAction({
      appId,
      operationId: intent.data.operationId,
      versionName: String(data.get('versionName') ?? ''),
      versionCode: Number(data.get('versionCode')),
      changelog: String(data.get('changelog') ?? ''),
      size: file.size,
      sha256,
    });
    setActive(false);
    if (!finalized.ok) {
      setMessage(finalized.error.message);
      return;
    }
    setStep('review');
    setMessage(`Taslak sürüm hazır: ${finalized.data.id}`);
  }

  return (
    <form
      className="record-form upload-wizard"
      onSubmit={event => {
        event.preventDefault();
        void run(event.currentTarget).catch(() => {
          setActive(false);
          setMessage('Upload geçici olarak tamamlanamadı. Yeniden deneyebilirsin.');
        });
      }}
    >
      <ol aria-label="Yayın adımları" className="wizard-steps">
        {(['metadata', 'hash', 'upload', 'review'] as const).map((item, index) => (
          <li aria-current={step === item ? 'step' : undefined} key={item}>{index + 1}. {item}</li>
        ))}
      </ol>
      <div className="desktop-publish-warning">APK yayınlama dar ekranda kapalıdır; masaüstünden devam et.</div>
      <div className="publish-fields">
        <label className="field"><span>APK dosyası</span><input accept=".apk,application/vnd.android.package-archive,application/octet-stream" name="apk" required type="file" /></label>
        <label className="field"><span>Sürüm adı</span><input maxLength={40} name="versionName" required /></label>
        <label className="field"><span>Sürüm kodu</span><input min={1} name="versionCode" required type="number" /></label>
        <label className="field"><span>Değişiklik notları</span><textarea maxLength={5000} name="changelog" rows={6} /></label>
        <button className="primary-button" disabled={active} type="submit">{active ? 'İşleniyor…' : 'Upload başlat'}</button>
      </div>
      <p aria-live="polite">{active ? `İlerleme: %${progress}` : message}</p>
    </form>
  );
}
