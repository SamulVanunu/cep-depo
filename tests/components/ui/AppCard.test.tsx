import { fireEvent, render } from '@testing-library/react-native';

import { AppCard } from '../../../src/components/ui/AppCard';
import type { CatalogCard } from '../../../src/features/catalog/catalog.types';

const app: CatalogCard = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  slug: 'cep-iptv',
  title: 'Cep IPTV',
  shortDescription: 'Canlı yayın listelerini sade bir arayüzde aç.',
  iconPath: null,
  category: {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'eglence',
    name: 'Eğlence',
  },
  featured: true,
  downloadCount: 5,
  currentVersion: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    name: '1.2',
    code: 12,
    changelog: 'Performans iyileştirmeleri.',
    apkPath: 'apps/a/versions/b.apk',
    apkSizeBytes: 24_000_000,
    sha256: 'b'.repeat(64),
    publishedAt: '2026-09-28T10:00:00Z',
  },
};

describe('AppCard', () => {
  it('announces app title, category and version without relying on color', () => {
    const rendered = render(<AppCard app={app} onPress={jest.fn()} />);

    expect(rendered.getByLabelText('Cep IPTV, Eğlence, sürüm 1.2')).toBeTruthy();
    expect(rendered.getByText('Öne çıkan')).toBeTruthy();
  });

  it('opens the selected app and labels a deterministic icon fallback', () => {
    const onPress = jest.fn();
    const rendered = render(<AppCard app={app} onPress={onPress} />);

    fireEvent.press(rendered.getByRole('button'));

    expect(onPress).toHaveBeenCalledWith(app);
    expect(rendered.getByLabelText('Cep IPTV için varsayılan ikon')).toBeTruthy();
  });
});
