'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { setAppPublicationStatusAction } from './app-actions';

export function AppStatusPanel({ appId, status }: Readonly<{
  appId: string;
  status: 'active' | 'archived';
}>) {
  const router = useRouter();
  const nextStatus = status === 'active' ? 'archived' : 'active';
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (message && !pending) buttonRef.current?.focus();
  }, [message, pending]);

  function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await setAppPublicationStatusAction(appId, nextStatus);
        if (!result.ok) {
          setMessage(result.error.message);
          buttonRef.current?.focus();
          return;
        }
        router.refresh();
      } catch {
        setMessage('İşlem geçici olarak tamamlanamadı. Lütfen yeniden dene.');
        buttonRef.current?.focus();
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <section aria-labelledby="status-heading" className="panel-section">
      <h2 id="status-heading">Yayın durumu</h2>
      <p className="muted">
        {nextStatus === 'archived'
          ? 'Arşivlenen uygulama public katalogda gösterilmez. Bu işlem silme değildir.'
          : 'Uygulama yeniden katalogda görünür duruma gelir.'}
      </p>
      <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <button ref={buttonRef} className={nextStatus === 'archived' ? 'danger-button' : 'primary-button'} disabled={pending} type="submit">
          {pending ? 'İşleniyor…' : nextStatus === 'archived' ? 'Yayından kaldır' : 'Tekrar yayınla'}
        </button>
      </form>
      {message ? <p className="inline-error" role="alert">{message}</p> : null}
    </section>
  );
}
