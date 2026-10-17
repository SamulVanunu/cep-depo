import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appId = 'a2000000-0000-4000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  getApp: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock('./app-dal', () => ({
  getApp: mocks.getApp,
  listCategories: mocks.listCategories,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AppDetailPage from '../../../app/(dashboard)/apps/[appId]/page';

describe('App manage page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCategories.mockResolvedValue([]);
    mocks.getApp.mockResolvedValue({
      id: appId,
      title: 'Örnek Uygulama',
      slug: 'ornek-uygulama',
      status: 'active',
      category_id: 'c1000000-0000-4000-8000-000000000001',
      short_description: 'Yeterince uzun kısa açıklama',
      description: 'Yeterince uzun uygulama açıklaması',
      featured: false,
      icon_path: null,
      app_screenshots: [],
      app_versions: [
        {
          id: 'v1000000-0000-4000-8000-000000000001',
          version_name: '1.0.0',
          version_code: 1,
          status: 'published',
          package_name: 'com.example.app',
          published_at: null,
        },
      ],
      categories: { id: 'c1000000-0000-4000-8000-000000000001', name: 'Araçlar' },
    });
  });

  it('renders the unified management actions', async () => {
    render(await AppDetailPage({ params: Promise.resolve({ appId }) }));

    expect(screen.getByRole('link', { name: 'Bilgileri düzenle' })).toHaveAttribute('href', '#application-details');
    expect(screen.getByRole('link', { name: 'Yeni APK ile güncelle' })).toHaveAttribute(
      'href',
      `/publish?appId=${encodeURIComponent(appId)}`,
    );
    expect(screen.getByRole('button', { name: 'Yayından kaldır' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Kalıcı sil' })).toBeDisabled();
    expect(screen.getByText(/com\.example\.app/)).toBeVisible();
  });
});