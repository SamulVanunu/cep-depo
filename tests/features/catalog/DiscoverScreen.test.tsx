import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { DiscoverScreen } from '../../../src/features/catalog/DiscoverScreen';
import { useCatalogApps, useCategories } from '../../../src/features/catalog/catalog.queries';
import type { CatalogCard, Category } from '../../../src/features/catalog/catalog.types';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../../../src/features/catalog/catalog.queries', () => ({
  catalogKeys: { all: ['catalog'] },
  useCatalogApps: jest.fn(),
  useCategories: jest.fn(),
}));

const categories: Category[] = [
  { id: '1', slug: 'eski', name: 'Eski' },
  { id: '2', slug: 'yeni', name: 'Yeni' },
];

function card(title: string, slug: string, category = categories[0]): CatalogCard {
  return {
    id: slug,
    slug,
    title,
    shortDescription: `${title} açıklaması burada.`,
    iconPath: null,
    category,
    featured: false,
    downloadCount: 1,
    currentVersion: {
      id: `${slug}-version`,
      name: '1.2',
      code: 12,
      changelog: '',
      apkPath: `apps/${slug}/versions/1.apk`,
      apkSizeBytes: 1,
      sha256: 'a'.repeat(64),
      publishedAt: '2026-10-01T00:00:00Z',
    },
  };
}

const mockUseCatalogApps = useCatalogApps as jest.MockedFunction<typeof useCatalogApps>;
const mockUseCategories = useCategories as jest.MockedFunction<typeof useCategories>;

function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isError: false,
    isFetching: false,
    isPending: false,
    refetch: jest.fn(),
    ...overrides,
  } as never;
}

function renderDiscover() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<DiscoverScreen />, { wrapper: Wrapper });
}

describe('DiscoverScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCategories.mockReturnValue(queryResult({ data: categories }));
  });

  it.each([
    ['loading', queryResult({ isPending: true }), 'Katalog yükleniyor'],
    ['empty-store', queryResult({ data: [] }), 'Mağaza henüz boş.'],
    ['error', queryResult({ isError: true, error: new Error('offline') }), 'Uygulamalar yüklenemedi.'],
  ])('renders the %s state without stale cards', (_state, result, expectedText) => {
    mockUseCatalogApps.mockReturnValue(result);

    renderDiscover();

    expect(screen.getByText(expectedText)).toBeTruthy();
    expect(screen.queryByTestId('catalog-list')).toBeNull();
  });

  it('renders an empty-search state instead of the empty-store message', () => {
    mockUseCatalogApps.mockReturnValue(queryResult({ data: [] }));
    renderDiscover();

    fireEvent.changeText(screen.getByLabelText('Uygulama ara'), 'İpTv');

    expect(screen.getByText('Sonuç bulunamadı.')).toBeTruthy();
    expect(screen.queryByText('Mağaza henüz boş.')).toBeNull();
  });

  it('discards cards from the previous category after a rapid category change', () => {
    mockUseCatalogApps.mockImplementation(filters => {
      if (filters.categorySlug === 'eski') {
        return queryResult({ data: [card('Eski kategori uygulaması', 'eski-app')] });
      }
      if (filters.categorySlug === 'yeni') {
        return queryResult({ data: [card('Yeni kategori uygulaması', 'yeni-app', categories[1])] });
      }
      return queryResult({ data: [] });
    });
    renderDiscover();

    fireEvent.press(screen.getByRole('button', { name: 'Eski kategorisi' }));
    fireEvent.press(screen.getByRole('button', { name: 'Yeni kategorisi' }));

    expect(screen.queryByText('Eski kategori uygulaması')).toBeNull();
    expect(screen.getByText('Yeni kategori uygulaması')).toBeTruthy();
  });

  it('opens an app detail route from a card', () => {
    mockUseCatalogApps.mockReturnValue(queryResult({ data: [card('Cep IPTV', 'cep-iptv')] }));
    renderDiscover();

    fireEvent.press(screen.getByLabelText('Cep IPTV, Eski, sürüm 1.2'));

    expect(mockPush).toHaveBeenCalledWith('/apps/cep-iptv');
  });
});
