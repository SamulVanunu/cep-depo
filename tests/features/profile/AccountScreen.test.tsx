import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';

import {
  AccountScreen,
  signOutAndClearPrivateData,
} from '../../../src/features/profile/AccountScreen';
import type { AccountReview, Profile } from '../../../src/features/profile/profile.types';

const activeProfile: Profile = {
  userId: 'user-1',
  username: 'Çağrı_Öz',
  avatarPath: 'user-1/avatar.webp',
  status: 'active',
};

const suspendedProfile: Profile = { ...activeProfile, status: 'suspended' };

const reviews: readonly AccountReview[] = [
  {
    id: 'review-1',
    appSlug: 'ornek-uygulama',
    appTitle: 'Örnek Uygulama',
    rating: 4,
    body: 'İşimi gördü.',
    updatedAt: '2026-10-01T12:00:00Z',
  },
];

function props() {
  return {
    email: 'user@example.com',
    profile: activeProfile,
    reviews,
    isLoading: false,
    isError: false,
    isReviewsLoading: false,
    isReviewsError: false,
    isUsernamePending: false,
    isAvatarPending: false,
    onRetry: jest.fn(),
    onUpdateUsername: jest.fn().mockResolvedValue(undefined),
    onUploadAvatar: jest.fn().mockResolvedValue(undefined),
    onRemoveAvatar: jest.fn().mockResolvedValue(undefined),
    onOpenReview: jest.fn(),
    onSignOut: jest.fn().mockResolvedValue(undefined),
    resolveAvatarUrl: jest.fn((path: string) => `https://cdn.example/${path}`),
    pickImage: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  };
}

describe('Profile AccountScreen', () => {
  it('shows loading and retryable error states', () => {
    const loadingProps = props();
    const view = render(<AccountScreen {...loadingProps} isLoading profile={undefined} />);
    expect(screen.getByText('Profil yükleniyor')).toBeTruthy();

    const errorProps = props();
    view.rerender(<AccountScreen {...errorProps} isError profile={undefined} />);
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(errorProps.onRetry).toHaveBeenCalledTimes(1);
  });

  it('edits an active username and exposes no immutable profile fields', async () => {
    const callbacks = props();
    render(<AccountScreen {...callbacks} />);

    expect(screen.getByText('Çağrı_Öz')).toBeTruthy();
    expect(screen.queryByLabelText('Kullanıcı kimliği')).toBeNull();
    expect(screen.queryByLabelText('Profil durumu')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Kullanıcı adını düzenle' }));
    fireEvent.changeText(screen.getByLabelText('Kullanıcı adı'), 'Yeni.Ad');
    fireEvent.press(screen.getByRole('button', { name: 'Kullanıcı adını kaydet' }));

    await waitFor(() => expect(callbacks.onUpdateUsername).toHaveBeenCalledWith('Yeni.Ad'));
  });

  it('does nothing when avatar picking is cancelled', async () => {
    const callbacks = props();
    render(<AccountScreen {...callbacks} />);

    fireEvent.press(screen.getByRole('button', { name: 'Avatarı değiştir' }));

    await waitFor(() => expect(callbacks.pickImage).toHaveBeenCalledTimes(1));
    expect(callbacks.onUploadAvatar).not.toHaveBeenCalled();
  });

  it('uploads a selected avatar and shows avatar progress', async () => {
    const callbacks = props();
    callbacks.pickImage.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///avatar.png', mimeType: 'image/png', fileSize: 1024 },
      ],
    });
    const view = render(<AccountScreen {...callbacks} />);

    fireEvent.press(screen.getByRole('button', { name: 'Avatarı değiştir' }));
    await waitFor(() =>
      expect(callbacks.onUploadAvatar).toHaveBeenCalledWith({
        uri: 'file:///avatar.png',
        mimeType: 'image/png',
        size: 1024,
      }),
    );

    view.rerender(<AccountScreen {...callbacks} isAvatarPending />);
    expect(screen.getByRole('button', { name: 'Avatarı değiştir' }).props.accessibilityState).toEqual(
      expect.objectContaining({ busy: true, disabled: true }),
    );
  });

  it('removes the current avatar through the explicit action', async () => {
    const callbacks = props();
    render(<AccountScreen {...callbacks} />);

    fireEvent.press(screen.getByRole('button', { name: 'Avatarı kaldır' }));

    await waitFor(() => expect(callbacks.onRemoveAvatar).toHaveBeenCalledTimes(1));
  });

  it('explains suspended read-only state and hides profile editing actions', () => {
    render(<AccountScreen {...props()} profile={suspendedProfile} />);

    expect(screen.getByText('Hesabın askıya alındı.')).toBeTruthy();
    expect(screen.getByText('Çağrı_Öz')).toBeTruthy();
    expect(screen.getByLabelText('Çağrı_Öz avatarı')).toBeTruthy();
    expect(
      screen.getByText('Profilini ve yorumlarını görebilirsin; topluluk değişiklikleri kapalıdır.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kullanıcı adını düzenle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avatarı değiştir' })).toBeNull();
  });

  it('opens own review history links and allows sign out', async () => {
    const callbacks = props();
    render(<AccountScreen {...callbacks} />);

    expect(screen.getByText('4/5')).toBeTruthy();
    expect(screen.getByText('İşimi gördü.')).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'Örnek Uygulama yorumunu aç' }));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Çıkış yap' })));
    expect(callbacks.onOpenReview).toHaveBeenCalledWith('ornek-uygulama');
    expect(callbacks.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('shows a safe error when sign out fails', async () => {
    const callbacks = props();
    callbacks.onSignOut.mockRejectedValue(new Error('refresh token secret detail'));
    render(<AccountScreen {...callbacks} />);

    fireEvent.press(screen.getByRole('button', { name: 'Çıkış yap' }));

    await waitFor(() =>
      expect(screen.getByText('Çıkış yapılamadı. Lütfen tekrar deneyin.')).toBeTruthy(),
    );
    expect(screen.queryByText(/refresh token/i)).toBeNull();
  });

  it('shows a retry action when review history fails', () => {
    const callbacks = props();
    render(<AccountScreen {...callbacks} isReviewsError reviews={undefined} />);

    expect(screen.getByText('Yorumların yüklenemedi.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Yorumları tekrar yükle' }));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('signOutAndClearPrivateData', () => {
  it('removes only profile-prefixed private queries after successful signout', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['profile', 'mine', 'user-1'], activeProfile);
    queryClient.setQueryData(['profile', 'reviews', 'user-1'], reviews);
    queryClient.setQueryData(['catalog', 'apps'], ['public']);
    const signOut = jest.fn().mockResolvedValue(undefined);

    await signOutAndClearPrivateData(signOut, queryClient);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['profile', 'mine', 'user-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['profile', 'reviews', 'user-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['catalog', 'apps'])).toEqual(['public']);
    queryClient.clear();
  });

  it('preserves private cache if signout fails', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['profile', 'mine', 'user-1'], activeProfile);

    await expect(
      signOutAndClearPrivateData(
        jest.fn().mockRejectedValue(new Error('signout failed')),
        queryClient,
      ),
    ).rejects.toThrow('signout failed');
    expect(queryClient.getQueryData(['profile', 'mine', 'user-1'])).toEqual(activeProfile);
    queryClient.clear();
  });
});
