import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { profileKeys } from '../../../src/features/profile/profile.queries';
import {
  reviewKeys,
  useDeleteReview,
  useMyReview,
  useRatingSummary,
  useSaveReview,
  useVisibleReviews,
} from '../../../src/features/reviews/review.queries';
import * as reviewRepositoryModule from '../../../src/features/reviews/review.repository';
import type { Review } from '../../../src/features/reviews/review.types';

jest.mock('../../../src/lib/supabase', () => ({ getSupabaseClient: jest.fn(() => ({})) }));

const review: Review = {
  id: 'review-1',
  appId: 'app-1',
  userId: 'user-1',
  username: 'User.One',
  avatarPath: null,
  rating: 5,
  body: 'İyi',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

function setup() {
  const repository = {
    getSummary: jest.fn().mockResolvedValue({ average: 5, count: 1 }),
    listVisible: jest.fn().mockResolvedValue([review]),
    getMine: jest.fn().mockResolvedValue(review),
    saveMine: jest.fn().mockResolvedValue(review),
    deleteMine: jest.fn().mockResolvedValue(undefined),
  };
  jest.spyOn(reviewRepositoryModule, 'createReviewRepository').mockReturnValue(repository);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { repository, client, wrapper };
}

describe('review query keys and reads', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scopes keys by app and current user', () => {
    expect(reviewKeys.summary('app-1')).toEqual(['reviews', 'app', 'app-1', 'summary']);
    expect(reviewKeys.visible('app-1')).toEqual(['reviews', 'app', 'app-1', 'visible']);
    expect(reviewKeys.mine('app-1', 'user-1')).toEqual([
      'reviews',
      'app',
      'app-1',
      'mine',
      'user-1',
    ]);
  });

  it('disables reads without their required IDs', async () => {
    const { repository, wrapper } = setup();

    const summary = renderHook(() => useRatingSummary(''), { wrapper });
    const visible = renderHook(() => useVisibleReviews(''), { wrapper });
    const mine = renderHook(() => useMyReview('app-1', undefined), { wrapper });

    await act(async () => undefined);
    expect(repository.getSummary).not.toHaveBeenCalled();
    expect(repository.listVisible).not.toHaveBeenCalled();
    expect(repository.getMine).not.toHaveBeenCalled();
    summary.unmount();
    visible.unmount();
    mine.unmount();
  });

  it('passes only scoped IDs into enabled reads', async () => {
    const { repository, wrapper } = setup();

    const summary = renderHook(() => useRatingSummary('app-1'), { wrapper });
    const visible = renderHook(() => useVisibleReviews('app-1'), { wrapper });
    const mine = renderHook(() => useMyReview('app-1', 'user-1'), { wrapper });

    await waitFor(() => expect(summary.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(visible.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(mine.result.current.isSuccess).toBe(true));
    expect(repository.getSummary).toHaveBeenCalledWith('app-1');
    expect(repository.listVisible).toHaveBeenCalledWith('app-1');
    expect(repository.getMine).toHaveBeenCalledWith('app-1', 'user-1');
    summary.unmount();
    visible.unmount();
    mine.unmount();
  });
});

describe.each([
  ['save', useSaveReview] as const,
  ['delete', useDeleteReview] as const,
])('%s review invalidation', (operation, useMutationHook) => {
  afterEach(() => jest.restoreAllMocks());

  it('invalidates only dependent review/profile keys and preserves catalog data', async () => {
    const { repository, client, wrapper } = setup();
    client.setQueryData(['catalog', 'apps'], ['public']);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const remove = jest.spyOn(client, 'removeQueries');
    const clear = jest.spyOn(client, 'clear');
    const hook = renderHook(() => useMutationHook('app-1', 'user-1'), { wrapper });

    await act(async () => {
      if (operation === 'save') {
        await (hook.result.current as ReturnType<typeof useSaveReview>).mutateAsync({
          rating: 5,
          body: 'İyi',
        });
      } else {
        await (hook.result.current as ReturnType<typeof useDeleteReview>).mutateAsync();
      }
    });

    expect(repository[operation === 'save' ? 'saveMine' : 'deleteMine']).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reviewKeys.summary('app-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reviewKeys.visible('app-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reviewKeys.mine('app-1', 'user-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.reviews('user-1') });
    expect(remove).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(client.getQueryData(['catalog', 'apps'])).toEqual(['public']);
    hook.unmount();
    client.getQueryCache().clear();
    client.getMutationCache().clear();
  });
});
