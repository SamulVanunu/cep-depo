'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { logoutAction } from '../../../app/(auth)/login/actions';

const destinations = [
  { href: '/publish', label: 'APK Yükle' },
  { href: '/apps', label: 'Uygulamalar' },
  { href: '/reviews', label: 'Yorumlar' },
  { href: '/reports', label: 'Şikâyetler' },
  { href: '/users', label: 'Kullanıcılar' },
  { href: '/settings', label: 'Ayarlar' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/publish') return pathname === href;
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div>
        <Link className="brand" href="/" aria-label="Cep Depo yönetim özeti">
          <span aria-hidden="true" className="brand-mark">CD</span>
          <span>
            <strong>Cep Depo</strong>
            <small>Operasyon</small>
          </span>
        </Link>

        <nav aria-label="Yönetim bölümleri" className="sidebar-nav">
          {destinations.map(destination => {
            const active = isActive(pathname, destination.href);
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={active ? 'nav-link nav-link--active' : 'nav-link'}
                href={destination.href}
                key={destination.href}
              >
                <span>{destination.label}</span>
                {active ? <span className="visually-hidden"> aktif</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>

      <form action={logoutAction}>
        <button className="secondary-button sidebar-logout" type="submit">Çıkış yap</button>
      </form>
    </aside>
  );
}
