import * as Linking from 'expo-linking';
import { fireEvent, render, screen } from '@testing-library/react-native';

import AboutRoute from '../../app/(tabs)/about';
import { getPublicLinks } from '../../src/lib/public-links';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0' } },
}));

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => undefined) }));

describe('About route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      EXPO_PUBLIC_PRIVACY_URL: 'https://cepdepo.example/gizlilik',
      EXPO_PUBLIC_TERMS_URL: 'https://cepdepo.example/kosullar',
      EXPO_PUBLIC_CONTACT_URL: 'mailto:destek@cepdepo.example',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('shows app version, privacy, terms, contact and open-source entries', () => {
    render(<AboutRoute />);

    expect(screen.getByText('Sürüm 0.1.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Gizlilik' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kullanım koşulları' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'İletişim' })).toBeTruthy();
    expect(screen.getByText('Açık kaynak')).toBeTruthy();
  });

  it('opens only a validated public link', () => {
    render(<AboutRoute />);

    fireEvent.press(screen.getByRole('link', { name: 'Gizlilik' }));

    expect(Linking.openURL).toHaveBeenCalledWith('https://cepdepo.example/gizlilik');
  });

  it('marks unsupported or missing links as unconfigured without opening them', () => {
    const privacyKey = ['EXPO', 'PUBLIC', 'PRIVACY', 'URL'].join('_');
    const termsKey = ['EXPO', 'PUBLIC', 'TERMS', 'URL'].join('_');
    const contactKey = ['EXPO', 'PUBLIC', 'CONTACT', 'URL'].join('_');
    process.env[privacyKey] = 'javascript:alert(1)';
    delete process.env[termsKey];
    process.env[contactKey] = 'tel:+900000000';
    expect(getPublicLinks()).toEqual({ privacy: null, terms: null, contact: null });
    render(<AboutRoute />);

    expect(screen.getAllByText('Yapılandırılmadı')).toHaveLength(3);
    expect(screen.queryByRole('link')).toBeNull();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
