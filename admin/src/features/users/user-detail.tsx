'use client';

import { useState, useTransition } from 'react';

import {
  activateUserAction,
  deleteUserAction,
  requestRecoveryAction,
  suspendUserAction,
} from './user-actions';

type ManagedUser = Awaited<ReturnType<typeof import('./user-dal')['getManagedUser']>>;

export function UserDetail({ user }: Readonly<{ user: ManagedUser }>) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const execute = (action: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) => {
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? success : result.error?.message ?? 'İşlem tamamlanamadı.');
    });
  };
  return (
    <>
      <section className="panel-section"><h2>Hesap durumu</h2><dl className="detail-list"><div><dt>E-posta</dt><dd>{user.email}</dd></div><div><dt>Profil</dt><dd>{user.status}</dd></div><div><dt>Auth ban</dt><dd>{user.banned ? 'Aktif' : 'Yok'}</dd></div><div><dt>Tutarlılık</dt><dd>{user.consistency === 'partial' ? 'Kısmi — yeniden deneme gerekli' : 'Tutarlı'}</dd></div><div><dt>Son giriş</dt><dd>{user.lastSignInAt ?? 'Henüz giriş yok'}</dd></div><div><dt>Topluluk</dt><dd>{user.reviewCount} yorum · {user.reportCount} şikâyet</dd></div></dl>
        {!user.isAdmin ? <div className="header-actions"><button className="secondary-button" disabled={pending} onClick={() => execute(() => user.status === 'active' ? suspendUserAction(user.id) : activateUserAction(user.id), 'Hesap durumu güncellendi.')} type="button">{user.status === 'active' ? 'Askıya al' : 'Etkinleştir'}</button><button className="secondary-button" disabled={pending} onClick={() => execute(() => requestRecoveryAction(user.id), 'Recovery isteği gönderildi.')} type="button">Şifre sıfırlama gönder</button></div> : <p className="form-warning">Yönetici hesaplarında askıya alma ve silme kapalıdır.</p>}
      </section>
      {!user.isAdmin ? <section className="danger-panel"><h2>Kalıcı silme</h2><p className="muted">Önce hesap askıya alınmalıdır. Bu işlem Auth hesabını ve ilişkili topluluk verilerini geri döndürülemez biçimde siler.</p><div className="desktop-delete-warning">Kalıcı silme dar ekranda kapalıdır; masaüstünden devam et.</div><form className="delete-user-form" onSubmit={event => { event.preventDefault(); const confirmation = String(new FormData(event.currentTarget).get('confirmation') ?? ''); execute(() => deleteUserAction({ userId: user.id, confirmation }), 'Kullanıcı silindi.'); }}><label className="field"><span>Onay için kullanıcı adını yaz: {user.username}</span><input autoComplete="off" name="confirmation" required /></label><button className="danger-button" disabled={pending || user.status !== 'suspended'} type="submit">Kullanıcıyı kalıcı sil</button></form></section> : null}
      {message ? <p aria-live="polite">{message}</p> : null}
    </>
  );
}
