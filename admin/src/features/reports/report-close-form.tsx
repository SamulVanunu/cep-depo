'use client';

import { useState, useTransition } from 'react';

import { closeReportAction } from './report-actions';

export function ReportCloseForm({ reportId }: Readonly<{ reportId: string }>) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="record-form"
      onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await closeReportAction({
            reportId,
            status: String(data.get('status')) as 'resolved' | 'dismissed',
            adminNote: String(data.get('adminNote') ?? ''),
          });
          setMessage(result.ok ? 'Şikâyet kapatıldı.' : result.error.message);
        });
      }}
    >
      <label className="field"><span>Sonuç</span><select name="status"><option value="resolved">Çözüldü</option><option value="dismissed">Reddedildi</option></select></label>
      <label className="field"><span>Yönetici notu</span><textarea maxLength={2000} minLength={1} name="adminNote" required rows={6} /></label>
      <button className="primary-button" disabled={pending} type="submit">{pending ? 'Kapatılıyor…' : 'Şikâyeti kapat'}</button>
      {message ? <p aria-live="polite">{message}</p> : null}
    </form>
  );
}
