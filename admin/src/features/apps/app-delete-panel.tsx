'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { deleteAppPermanentlyAction } from './app-actions';

export function AppDeletePanel({ appId, title }: Readonly<{ appId: string; title: string }>) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = confirmation === title;

  useEffect(() => {
    if (error && !pending) inputRef.current?.focus();
  }, [error, pending]);

  function submit() {
    if (!matches || submitting.current || deleted) return;
    submitting.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteAppPermanentlyAction(appId, confirmation);
        if (!result.ok) {
          setError(result.error.message);
          inputRef.current?.focus();
          return;
        }
        setDeleted(true);
        if (result.data.cleanupPending) {
          setCleanupPending(true);
          return;
        }
        router.push('/apps');
      } catch {
        setError('İşlem geçici olarak tamamlanamadı. Lütfen yeniden dene.');
        inputRef.current?.focus();
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <section aria-labelledby="delete-app-heading" className="danger-panel">
      <h2 id="delete-app-heading">Kalıcı silme</h2>
      <p className="muted">
        Bu işlem uygulamayı, sürümlerini ve ilişkili topluluk verilerini geri döndürülemez biçimde siler.
        Geçici olarak gizlemek için yukarıdaki “Yayından kaldır” işlemini kullan.
      </p>
      <form className="delete-app-form" onSubmit={event => { event.preventDefault(); submit(); }}>
        <label className="field">
          <span>Onay için uygulama adını yaz: {title}</span>
          <input
            ref={inputRef}
            aria-describedby="delete-app-help"
            autoComplete="off"
            disabled={pending || deleted}
            onChange={event => setConfirmation(event.currentTarget.value)}
            required
            value={confirmation}
          />
        </label>
        <p className="muted" id="delete-app-help">Büyük/küçük harf ve boşluklar dahil tam olarak eşleşmelidir.</p>
        <button className="danger-button" disabled={!matches || pending || deleted} type="submit">
          {pending ? 'Siliniyor…' : 'Kalıcı sil'}
        </button>
      </form>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {deleted && cleanupPending ? (
        <p role="status">
          Uygulama silindi; bazı dosyalar temizleme bekliyor. <Link href="/apps">Uygulamalara dön</Link>
        </p>
      ) : null}
    </section>
  );
}
