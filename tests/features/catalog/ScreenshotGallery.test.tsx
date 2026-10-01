import { render, screen } from '@testing-library/react-native';

import { ScreenshotGallery } from '../../../src/features/catalog/ScreenshotGallery';
import type { CatalogScreenshot } from '../../../src/features/catalog/catalog.types';

const screenshots: CatalogScreenshot[] = [
  { id: '3', path: '03.webp', altText: 'Ayarlar ekranı', position: 2 },
  { id: '1', path: '01.webp', altText: 'Ana ekran', position: 0 },
  { id: '2', path: '02.webp', altText: 'Oynatıcı ekranı', position: 1 },
];

describe('ScreenshotGallery', () => {
  it('renders screenshots by position with useful labels', () => {
    render(
      <ScreenshotGallery
        resolveAssetUrl={path => `https://assets.example/${path}`}
        screenshots={screenshots}
      />,
    );

    expect(screen.getAllByLabelText(/Ekran görüntüsü/).map(image => image.props.accessibilityLabel)).toEqual([
      'Ekran görüntüsü 1/3: Ana ekran',
      'Ekran görüntüsü 2/3: Oynatıcı ekranı',
      'Ekran görüntüsü 3/3: Ayarlar ekranı',
    ]);
  });

  it('uses a deterministic empty fallback', () => {
    render(<ScreenshotGallery resolveAssetUrl={path => path} screenshots={[]} />);

    expect(screen.getByText('Henüz ekran görüntüsü eklenmemiş.')).toBeTruthy();
  });
});
