import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionException } from '../../server/errors/action-error';
import { Sidebar } from '../../components/navigation/sidebar';
import { DashboardView } from './dashboard-view';
import { mergeDashboardPriorities } from './dashboard-priorities';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => '/reports') }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname,
}));

const summary = {
  openReportCount: 3,
  hiddenReviewCount: 8,
  suspendedUserCount: 2,
  draftVersionCount: 4,
  priorities: [
    {
      id: 'report-1',
      kind: 'report' as const,
      title: 'Örnek Uygulama',
      detail: 'İndirme bağlantısı bozuk',
      href: '/reports/report-1',
      createdAt: '2026-10-05T10:00:00.000Z',
    },
  ],
  latestPublishedApps: Array.from({ length: 5 }, (_, index) => ({
    appId: `app-${index}`,
    title: `Yayınlanan ${index + 1}`,
    versionName: `1.${index}.0`,
    versionCode: index + 1,
    publishedAt: `2026-10-0${index + 1}T12:00:00.000Z`,
  })),
};

describe('DashboardView', () => {
  it('links each dashboard count to its filtered work queue', () => {
    render(<DashboardView summary={summary} />);

    expect(screen.getByRole('link', { name: /3 açık şikâyet/i })).toHaveAttribute(
      'href',
      '/reports?status=open',
    );
    expect(screen.getByRole('link', { name: /8 gizli yorum/i })).toHaveAttribute(
      'href',
      '/reviews?status=hidden',
    );
    expect(screen.getByRole('link', { name: /2 askıya alınmış kullanıcı/i })).toHaveAttribute(
      'href',
      '/users?status=suspended',
    );
    expect(screen.getByRole('link', { name: /4 sürüm taslağı/i })).toHaveAttribute(
      'href',
      '/apps?versionStatus=draft',
    );
  });

  it('puts the primary APK action before queues and renders five latest publications', () => {
    render(<DashboardView summary={summary} />);
    const publish = screen.getByRole('link', { name: 'APK Yükle' });
    const queues = screen.getByRole('heading', { name: 'İş kuyrukları' });
    expect(publish).toHaveAttribute('href', '/publish');
    expect(publish.compareDocumentPosition(queues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Yayınlanan \d/ })).toHaveLength(5);
  });
});

describe('mergeDashboardPriorities', () => {
  it('orders reports and incomplete operations oldest-first and caps the queue at ten', () => {
    const reports = Array.from({ length: 8 }, (_, index) => ({
      id: `report-${index}`,
      reason: 'link_bozuk',
      description: null,
      created_at: `2026-10-${String(index + 2).padStart(2, '0')}T10:00:00.000Z`,
      apps: { title: `Uygulama ${index}` },
    }));
    const operations = Array.from({ length: 5 }, (_, index) => ({
      id: `operation-${index}`,
      action: 'upload.cleanup',
      target_type: 'upload',
      target_id: `upload-${index}`,
      created_at: `2026-10-0${index + 1}T10:00:00.000Z`,
    }));

    const priorities = mergeDashboardPriorities(reports, operations);

    expect(priorities).toHaveLength(10);
    expect(priorities[0]).toMatchObject({ id: 'operation-0', kind: 'operation' });
    expect(priorities[9]).toMatchObject({ id: 'report-4', kind: 'report' });
  });
});

describe('Sidebar', () => {
  beforeEach(() => usePathname.mockReturnValue('/reports'));

  it('marks the active destination with text and aria-current', () => {
    render(<Sidebar />);

    const reportsLink = screen.getByRole('link', { name: /şikâyetler.*aktif/i });
    expect(reportsLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^APK Yükle$/i })).not.toHaveAttribute('aria-current');
  });

  it('orders publishing-first destinations and keeps logout available', () => {
    usePathname.mockReturnValue('/publish');
    render(<Sidebar />);
    const navigation = screen.getByRole('navigation', { name: 'Yönetim bölümleri' });
    expect(within(navigation).getAllByRole('link').map(link => link.textContent?.trim())).toEqual([
      'APK Yükle aktif',
      'Uygulamalar',
      'Yorumlar',
      'Şikâyetler',
      'Kullanıcılar',
      'Ayarlar',
    ]);
    expect(screen.getByRole('link', { name: /APK Yükle.*aktif/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
  });
});

describe('protected dashboard layout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows access denied to a signed-in non-admin instead of dashboard content', async () => {
    const { default: DashboardLayout } = await import('../../../app/(dashboard)/layout');
    const layout = await DashboardLayout(
      { children: <p>Gizli dashboard içeriği</p> },
      {
        authorize: vi.fn(async () => {
          throw new ActionException('FORBIDDEN');
        }),
      },
    );

    render(layout);

    expect(screen.getByRole('heading', { name: 'Erişim reddedildi' })).toBeInTheDocument();
    expect(screen.queryByText('Gizli dashboard içeriği')).not.toBeInTheDocument();
  });

  it('provides a keyboard skip link to the main dashboard content', async () => {
    const { default: DashboardLayout } = await import('../../../app/(dashboard)/layout');
    const layout = await DashboardLayout(
      { children: <h1>İçerik</h1> },
      { authorize: vi.fn(async () => undefined) },
    );
    render(layout);
    expect(screen.getByRole('link', { name: 'Ana içeriğe geç' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });
});
