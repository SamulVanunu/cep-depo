import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { User } from '@supabase/supabase-js';

import { useAuth } from '../../../src/features/auth/auth-context';
import { useMyProfile } from '../../../src/features/profile/profile.queries';
import { ReviewsSection } from '../../../src/features/reviews/ReviewsSection';
import {
  useDeleteReview,
  useMyReview,
  useRatingSummary,
  useSaveReview,
  useVisibleReviews,
} from '../../../src/features/reviews/review.queries';
import type { Review } from '../../../src/features/reviews/review.types';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../src/features/auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../../src/features/profile/profile.queries', () => ({ useMyProfile: jest.fn() }));
jest.mock('../../../src/features/reviews/review.queries', () => ({
  useRatingSummary: jest.fn(),
  useVisibleReviews: jest.fn(),
  useMyReview: jest.fn(),
  useSaveReview: jest.fn(),
  useDeleteReview: jest.fn(),
}));

const review: Review = {
  id: 'review-1',
  appId: 'app-1',
  userId: 'other-user',
  username: 'Diğer.Kullanıcı',
  avatarPath: null,
  rating: 4,
  body: 'İşimi gördü.',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

const mocks = {
  auth: useAuth as jest.MockedFunction<typeof useAuth>,
  profile: useMyProfile as jest.MockedFunction<typeof useMyProfile>,
  summary: useRatingSummary as jest.MockedFunction<typeof useRatingSummary>,
  visible: useVisibleReviews as jest.MockedFunction<typeof useVisibleReviews>,
  mine: useMyReview as jest.MockedFunction<typeof useMyReview>,
  save: useSaveReview as jest.MockedFunction<typeof useSaveReview>,
  delete: useDeleteReview as jest.MockedFunction<typeof useDeleteReview>,
};

function query(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    data,
    isPending: false,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    ...overrides,
  } as never;
}

function user(confirmed: boolean): User {
  return {
    id: 'user-1',
    aud: 'authenticated',
    email: 'user@example.com',
    email_confirmed_at: confirmed ? '2026-10-01T10:00:00Z' : undefined,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-01T09:00:00Z',
  };
}

describe('ReviewsSection', () => {
  const saveMutate = jest.fn().mockResolvedValue(review);
  const deleteMutate = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mocks.auth.mockReturnValue({ status: 'signedOut', session: null, user: null });
    mocks.profile.mockReturnValue(query(undefined));
    mocks.summary.mockReturnValue(query({ average: 4, count: 1 }));
    mocks.visible.mockReturnValue(query([review]));
    mocks.mine.mockReturnValue(query(null));
    mocks.save.mockReturnValue({ mutateAsync: saveMutate, isPending: false } as never);
    mocks.delete.mockReturnValue({ mutateAsync: deleteMutate, isPending: false } as never);
  });

  it('renders public summary/list and an anonymous login CTA', () => {
    render(<ReviewsSection appId="app-1" appSlug="ornek" />);

    expect(screen.getByText('4.0 / 5')).toBeTruthy();
    expect(screen.getByText('Diğer.Kullanıcı')).toBeTruthy();
    expect(screen.getByText('İşimi gördü.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirme yapmak için giriş yap' }));
    expect(mockPush).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('shows loading, empty and retryable public states', () => {
    mocks.summary.mockReturnValue(query(undefined, { isPending: true }));
    mocks.visible.mockReturnValue(query(undefined, { isPending: true }));
    const view = render(<ReviewsSection appId="app-1" appSlug="ornek" />);
    expect(screen.getByText('Değerlendirmeler yükleniyor')).toBeTruthy();

    mocks.summary.mockReturnValue(query({ average: null, count: 0 }));
    mocks.visible.mockReturnValue(query([]));
    view.rerender(<ReviewsSection appId="app-1" appSlug="ornek" />);
    expect(screen.getByText('Henüz puan yok')).toBeTruthy();
    expect(screen.getByText('Henüz yorum yok.')).toBeTruthy();

    const summaryRefetch = jest.fn();
    const visibleRefetch = jest.fn();
    mocks.summary.mockReturnValue(query(undefined, { isError: true, refetch: summaryRefetch }));
    mocks.visible.mockReturnValue(query(undefined, { isError: true, refetch: visibleRefetch }));
    view.rerender(<ReviewsSection appId="app-1" appSlug="ornek" />);
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeleri tekrar yükle' }));
    expect(summaryRefetch).toHaveBeenCalledTimes(1);
    expect(visibleRefetch).toHaveBeenCalledTimes(1);
  });

  it('routes an unconfirmed account to verification', () => {
    const authUser = user(false);
    mocks.auth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    render(<ReviewsSection appId="app-1" appSlug="ornek" />);

    fireEvent.press(screen.getByRole('button', { name: 'E-postayı doğrula' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/auth/confirm',
      params: { email: 'user@example.com' },
    });
  });

  it('shows suspended accounts a read-only notice', () => {
    const authUser = user(true);
    mocks.auth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    mocks.profile.mockReturnValue(
      query({ userId: 'user-1', username: 'User.One', avatarPath: null, status: 'suspended' }),
    );
    render(<ReviewsSection appId="app-1" appSlug="ornek" />);

    expect(screen.getByText('Hesabın askıya alındığı için değerlendirme yazamazsın.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Değerlendirmeyi kaydet' })).toBeNull();
  });

  it('shows the active current-user editor and saves through the scoped mutation', async () => {
    const authUser = user(true);
    mocks.auth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    mocks.profile.mockReturnValue(
      query({ userId: 'user-1', username: 'User.One', avatarPath: null, status: 'active' }),
    );
    render(<ReviewsSection appId="app-1" appSlug="ornek" />);

    fireEvent.press(screen.getByRole('radio', { name: '5 yıldız' }));
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi kaydet' }));
    await waitFor(() => expect(saveMutate).toHaveBeenCalledWith({ rating: 5, body: '' }));
  });
});
