import type { Metadata } from 'next';

import { LoginForm } from '../../../src/features/auth/login-form';

export const metadata: Metadata = { title: 'Giriş' };

export default function LoginPage() {
  return (
    <main className="login-page">
      <section aria-labelledby="login-heading" className="login-panel">
        <p className="eyebrow">Cep Depo Operasyon</p>
        <h1 id="login-heading">Yönetim paneli</h1>
        <p className="muted">Yalnız yetkili yönetici hesabınla devam et.</p>
        <LoginForm />
      </section>
    </main>
  );
}
