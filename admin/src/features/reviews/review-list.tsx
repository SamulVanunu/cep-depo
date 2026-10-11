'use client';

import { useState, useTransition } from 'react';

import { deleteHiddenReviewAction, setReviewVisibilityAction } from './review-actions';

type Review = Readonly<{
  id: string;
  rating: number;
  body: string | null;
  moderation_status: 'visible' | 'hidden';
  created_at: string;
  apps: Readonly<{ id: string; title: string }> | null;
  profiles: Readonly<{ user_id: string; username: string }> | null;
}>;

export function ReviewList({ reviews }: Readonly<{ reviews: readonly Review[] }>) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="moderation-list">
      {reviews.map(review => (
        <article className="moderation-card" key={review.id}>
          <header><strong>{review.apps?.title ?? 'Bilinmeyen uygulama'}</strong><span>{review.rating}/5 · {review.profiles?.username ?? 'Silinmiş kullanıcı'}</span></header>
          <p>{review.body || 'Yazılı yorum yok.'}</p>
          <footer>
            <span>{review.moderation_status === 'visible' ? 'Görünür' : 'Gizli'}</span>
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => startTransition(async () => {
                const next = review.moderation_status === 'visible' ? 'hidden' : 'visible';
                const result = await setReviewVisibilityAction(review.id, next);
                setMessage(result.ok ? 'Yorum durumu güncellendi.' : result.error.message);
              })}
              type="button"
            >{review.moderation_status === 'visible' ? 'Gizle' : 'Göster'}</button>
            {review.moderation_status === 'hidden' ? (
              <button
                className="danger-button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm('Gizli yorum kalıcı olarak silinsin mi?')) return;
                  startTransition(async () => {
                    const result = await deleteHiddenReviewAction(review.id);
                    setMessage(result.ok ? 'Yorum kalıcı olarak silindi.' : result.error.message);
                  });
                }}
                type="button"
              >Kalıcı sil</button>
            ) : null}
          </footer>
        </article>
      ))}
      {!reviews.length ? <p className="empty-state">Filtrelerle eşleşen yorum yok.</p> : null}
      {message ? <p aria-live="polite">{message}</p> : null}
    </div>
  );
}
