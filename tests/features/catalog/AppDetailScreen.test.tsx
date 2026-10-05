import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { AppDetailScreen } from '../../../src/features/catalog/AppDetailScreen';
import { useCatalogApp } from '../../../src/features/catalog/catalog.queries';
import type { CatalogApp } from '../../../src/features/catalog/catalog.types';
import { openApkDownload } from '../../../src/features/downloads/open-apk-download';
import { useDownloadedVersion } from '../../../src/features/downloads/useDownloadedVersion';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('../../../src/features/catalog/catalog.queries', () => ({
  useCatalogApp: jest.fn(),
}));

jest.mock('../../../src/features/downloads/open-apk-download', () => ({
  openApkDownload: jest.fn(),
}));

jest.mock('../../../src/features/downloads/useDownloadedVersion', () => ({
  useDownloadedVersion: jest.fn(),
}));

jest.mock('../../../src/features/reviews/ReviewsSection', () => {
  const { Text } = require('react-native');
  return { ReviewsSection: () => <Text>Değerlendirmeler bölümü</Text> };
});

jest.mock('../../../src/features/reports/ReportSheet', () => {
  const { Text } = require('react-native');
  return {
    ReportSheet: ({ target, visible }: { target: { appId: string; versionId: string | null }; visible: boolean }) =>
      visible ? <Text>{`${target.appId}:${target.versionId ?? 'app'}`}</Text> : null,
  };
});

const app: CatalogApp = {
  id: 'app-1',
  slug: 'cep-iptv',
  title: 'Cep IPTV',
  shortDescription: 'Canlı yayın listelerini sade bir arayüzde aç.',
  description: 'Uzun uygulama açıklaması.',
  iconPath: 'apps/app-1/icon.png',
  category: { id: 'category-1', slug: 'eglence', name: 'Eğlence' },
  featured: true,
  downloadCount: 5,
  currentVersion: {
    id: 'version-12',
    name: '1.2',
    code: 12,
    changelog: 'Güncel sürüm.',
    apkPath: 'apps/app-1/versions/version-12.apk',
    apkSizeBytes: 24_000_000,
    sha256: 'b'.repeat(64),
    publishedAt: '2026-09-28T10:00:00Z',
  },
  versions: [
    {
      id: 'version-10',
      name: '1.0',
      code: 10,
      changelog: 'İlk sürüm.',
      apkPath: 'apps/app-1/versions/version-10.apk',
      apkSizeBytes: 20_000_000,
      sha256: 'a'.repeat(64),
      publishedAt: '2026-09-20T10:00:00Z',
    },
    {
      id: 'version-12',
      name: '1.2',
      code: 12,
      changelog: 'Güncel sürüm.',
      apkPath: 'apps/app-1/versions/version-12.apk',
      apkSizeBytes: 24_000_000,
      sha256: 'b'.repeat(64),
      publishedAt: '2026-09-28T10:00:00Z',
    },
  ],
  screenshots: [
    { id: '3', path: '03.webp', altText: 'Ayarlar', position: 2 },
    { id: '1', path: '01.webp', altText: 'Ana ekran', position: 0 },
    { id: '2', path: '02.webp', altText: 'Oynatıcı', position: 1 },
  ],
};

const mockUseCatalogApp = useCatalogApp as jest.MockedFunction<typeof useCatalogApp>;
const mockOpenApkDownload = openApkDownload as jest.MockedFunction<typeof openApkDownload>;
const mockUseDownloadedVersion = useDownloadedVersion as jest.MockedFunction<typeof useDownloadedVersion>;

function queryResult(overrides: Record<string, unknown>) {
  return {
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    refetch: jest.fn(),
    ...overrides,
  } as never;
}

describe('AppDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDownloadedVersion.mockReturnValue({ downloadedVersion: undefined, refresh: jest.fn() });
    mockOpenApkDownload.mockResolvedValue({ metricsRecorded: true });
  });

  it('renders icon, description, ordered screenshots and descending published versions', () => {
    mockUseCatalogApp.mockReturnValue(queryResult({ data: app }));
    const view = render(
      <AppDetailScreen
        resolveAssetUrl={path => `https://assets.example/${path}`}
        slug="cep-iptv"
      />,
    );

    expect(screen.getByRole('header', { name: 'Cep IPTV' })).toBeTruthy();
    expect(screen.getByLabelText('Cep IPTV ikonu')).toBeTruthy();
    expect(screen.getByText('Uzun uygulama açıklaması.')).toBeTruthy();
    expect(screen.getAllByLabelText(/Ekran görüntüsü/)).toHaveLength(3);
    expect(screen.getByText('1.2 · Güncel sürüm')).toBeTruthy();
    expect(screen.getByText('1.0')).toBeTruthy();
    expect(screen.queryByText('1.3-beta')).toBeNull();
    expect(screen.getByText('Değerlendirmeler bölümü')).toBeTruthy();
    const tree = JSON.stringify(view.toJSON());
    expect(tree.indexOf('Değerlendirmeler bölümü')).toBeGreaterThan(tree.indexOf('Sürüm geçmişi'));
  });

  it('uses deterministic fallbacks when icon and screenshots are absent', () => {
    mockUseCatalogApp.mockReturnValue(
      queryResult({ data: { ...app, iconPath: null, screenshots: [] } }),
    );
    render(<AppDetailScreen resolveAssetUrl={path => path} slug="cep-iptv" />);

    expect(screen.getByLabelText('Cep IPTV için varsayılan ikon')).toBeTruthy();
    expect(screen.getByText('Henüz ekran görüntüsü eklenmemiş.')).toBeTruthy();
  });

  it('shows retry, not a blank page, when the detail request fails', () => {
    const refetch = jest.fn();
    mockUseCatalogApp.mockReturnValue(queryResult({ isError: true, refetch }));
    render(<AppDetailScreen resolveAssetUrl={path => path} slug="cep-iptv" />);

    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(screen.getByText('Uygulama yüklenemedi.')).toBeTruthy();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not query malformed route params as an app slug', () => {
    mockUseCatalogApp.mockReturnValue(queryResult({ data: null }));
    render(<AppDetailScreen resolveAssetUrl={path => path} slug="   " />);

    expect(mockUseCatalogApp).toHaveBeenCalledWith('');
    expect(screen.getByText('Uygulama bulunamadı.')).toBeTruthy();
  });

  it('shows update only for an older locally opened version', () => {
    mockUseCatalogApp.mockReturnValue(queryResult({ data: app }));
    mockUseDownloadedVersion.mockReturnValue({ downloadedVersion: 11, refresh: jest.fn() });
    render(<AppDetailScreen resolveAssetUrl={path => path} slug="cep-iptv" />);

    expect(screen.getByRole('button', { name: 'GÜNCELLE' })).toBeTruthy();
    expect(screen.getByText('İndirme, kurulumun tamamlandığı anlamına gelmez.')).toBeTruthy();
  });

  it('surfaces URL-open failures with a Turkish retry action', async () => {
    mockUseCatalogApp.mockReturnValue(queryResult({ data: app }));
    mockOpenApkDownload.mockRejectedValue(new Error('blocked'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    render(<AppDetailScreen resolveAssetUrl={path => path} slug="cep-iptv" />);

    fireEvent.press(screen.getByRole('button', { name: 'APK İNDİR' }));

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    const buttons = alert.mock.calls[0]?.[2];
    expect(alert.mock.calls[0]?.[0]).toBe('İndirme başlatılamadı.');
    expect(buttons?.map(button => button.text)).toContain('Tekrar dene');
  });

  it('opens reports only for the loaded app and its loaded versions', () => {
    mockUseCatalogApp.mockReturnValue(queryResult({ data: app }));
    render(<AppDetailScreen resolveAssetUrl={path => path} slug="route-could-be-arbitrary" />);

    fireEvent.press(screen.getByRole('button', { name: 'Uygulamayı şikâyet et' }));
    expect(screen.getByText('app-1:app')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '1.2 sürümünü şikâyet et' }));
    expect(screen.getByText('app-1:version-12')).toBeTruthy();
  });
});
