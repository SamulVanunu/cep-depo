'use client';

import type { Ref } from 'react';

import type { PublishReview } from './publish-types';

function formatBytes(bytes: number): string {
  return `${new Intl.NumberFormat('tr-TR').format(bytes)} bayt (${(bytes / 1024 / 1024).toFixed(2)} MiB)`;
}

export function ReviewStep({
  review,
  pending,
  onPublish,
  headingRef,
  error,
}: Readonly<{
  review: PublishReview;
  pending: boolean;
  onPublish(): void;
  headingRef?: Ref<HTMLHeadingElement>;
  error?: string | null;
}>) {
  return (
    <section aria-labelledby="review-step-heading" className="record-form">
      <div>
        <p className="eyebrow">3. adım</p>
        <h2 id="review-step-heading" ref={headingRef} tabIndex={-1}>Kontrol ve yayın</h2>
        <p className="muted">Bilgileri kontrol et. APK yalnız sen Yayınla dediğinde kataloğa çıkar.</p>
      </div>
      <dl className="detail-list">
        <div><dt>Uygulama</dt><dd>{review.app.title}</dd></div>
        <div><dt>Sürüm</dt><dd>{review.versionName} (kod {review.versionCode})</dd></div>
        <div><dt>Dosya</dt><dd>{review.fileName}</dd></div>
        <div>
          <dt>APK kaynağı</dt>
          <dd>{review.source.kind === 'external' ? 'Harici HTTPS' : 'Supabase Storage'}</dd>
        </div>
        {review.source.kind === 'external' ? (
          <div><dt>Kaynak sunucu</dt><dd>{review.source.hostname}</dd></div>
        ) : null}
        <div><dt>Boyut</dt><dd>{formatBytes(review.size)}</dd></div>
        <div><dt>Değişiklik notları</dt><dd>{review.changelog || 'Değişiklik notu eklenmedi.'}</dd></div>
      </dl>
      {review.app.isNew ? <p className="notice">Otomatik kategori: Genel</p> : null}
      <details>
        <summary>SHA-256 doğrulamasını göster</summary>
        <code>{review.sha256}</code>
      </details>
      {error ? <p aria-live="assertive" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={pending} onClick={onPublish} type="button">
        {error ? 'Tekrar yayınla' : 'Yayınla'}
      </button>
    </section>
  );
}
