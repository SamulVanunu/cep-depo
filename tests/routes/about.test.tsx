import * as Linking from 'expo-linking';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AboutScreen } from '../../app/(tabs)/about';
import { getPublicLinks } from '../../src/lib/public-links';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0' } },
}));

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => undefined) }));

describe('About route', () => {
  const configuredLinks = getPublicLinks({
    EXPO_PUBLIC_PRIVACY_URL: 'https://cepdepo.example/gizlilik',
    EXPO_PUBLIC_TERMS_URL: 'https://cepdepo.example/kosullar',
    EXPO_PUBLIC_CONTACT_URL: 'mailto:destek@cepdepo.example',
  });

  beforeEach(() => jest.clearAllMocks());

  it('shows app version, privacy, terms, contact and open-source entries', () => {
    render(<AboutScreen links={configuredLinks} />);

    expect(screen.getByText('Sürüm 0.1.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Gizlilik' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kullanım koşulları' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'İletişim' })).toBeTruthy();
    expect(screen.getByText('Açık kaynak')).toBeTruthy();
  });

  it('opens only a validated public link', () => {
    render(<AboutScreen links={configuredLinks} />);

    fireEvent.press(screen.getByRole('link', { name: 'Gizlilik' }));

    expect(Linking.openURL).toHaveBeenCalledWith('https://cepdepo.example/gizlilik');
  });

  it('marks unsupported or missing links as unconfigured without opening them', () => {
    const invalidLinks = getPublicLinks({
      EXPO_PUBLIC_PRIVACY_URL: 'javascript:alert(1)',
      EXPO_PUBLIC_CONTACT_URL: 'tel:+900000000',
    });
    expect(invalidLinks).toEqual({ privacy: null, terms: null, contact: null });
    render(<AboutScreen links={invalidLinks} />);

    expect(screen.getAllByText('Yapılandırılmadı')).toHaveLength(3);
    expect(screen.queryByRole('link')).toBeNull();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
