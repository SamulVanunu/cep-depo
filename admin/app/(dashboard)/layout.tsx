import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { Sidebar } from '../../src/components/navigation/sidebar';
import { requireAdmin } from '../../src/server/auth/require-admin';
import { ActionException } from '../../src/server/errors/action-error';

export const dynamic = 'force-dynamic';

export type DashboardLayoutDependencies = Readonly<{
  authorize(): Promise<unknown>;
}>;

export default async function DashboardLayout(
  { children }: Readonly<{ children: ReactNode }>,
  dependencies: DashboardLayoutDependencies = { authorize: requireAdmin },
) {
  try {
    await dependencies.authorize();
  } catch (error) {
    const errorCode =
      error instanceof ActionException || (error && typeof error === 'object' && 'code' in error)
        ? error.code
        : null;
    if (errorCode === 'UNAUTHENTICATED') redirect('/login');

    return (
      <main className="access-denied">
        <section>
          <p className="eyebrow">403</p>
          <h1>Erişim reddedildi</h1>
          <p className="muted">Bu alan yalnız Cep Depo yöneticileri tarafından kullanılabilir.</p>
          <a className="primary-button" href="/login">Başka hesapla giriş yap</a>
        </section>
      </main>
    );
  }

  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#main-content">Ana içeriğe geç</a>
      <Sidebar />
      <main className="dashboard-content" id="main-content">{children}</main>
    </div>
  );
}
