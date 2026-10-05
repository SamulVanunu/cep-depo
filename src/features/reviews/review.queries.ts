import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getSupabaseClient } from '../../lib/supabase';
import { profileKeys } from '../profile/profile.queries';
import { createReviewRepository } from './review.repository';
import type { ReviewDraft } from './review.types';

export const reviewKeys = {
  all: ['reviews'] as const,
  app: (appId: string) => [...reviewKeys.all, 'app', appId.trim()] as const,
  summary: (appId: string) => [...reviewKeys.app(appId), 'summary'] as const,
  visible: (appId: string) => [...reviewKeys.app(appId), 'visible'] as const,
  mine: (appId: string, userId: string) =>
    [...reviewKeys.app(appId), 'mine', userId] as const,
};

function repository() {
  return createReviewRepository(getSupabaseClient());
}

export function useRatingSummary(appId: string) {
  const normalizedAppId = appId.trim();
  return useQuery({
    queryKey: reviewKeys.summary(normalizedAppId),
    queryFn: () => repository().getSummary(normalizedAppId),
    enabled: normalizedAppId.length > 0,
  });
}

export function useVisibleReviews(appId: string) {
  const normalizedAppId = appId.trim();
  return useQuery({
    queryKey: reviewKeys.visible(normalizedAppId),
    queryFn: () => repository().listVisible(normalizedAppId),
    enabled: normalizedAppId.length > 0,
  });
}

export function useMyReview(appId: string, userId: string | undefined) {
  const normalizedAppId = appId.trim();
  return useQuery({
    queryKey: reviewKeys.mine(normalizedAppId, userId ?? ''),
    queryFn: () => repository().getMine(normalizedAppId, userId!),
    enabled: normalizedAppId.length > 0 && Boolean(userId),
  });
}

function useInvalidateReviewData(appId: string, userId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reviewKeys.summary(appId) }),
      queryClient.invalidateQueries({ queryKey: reviewKeys.visible(appId) }),
      queryClient.invalidateQueries({ queryKey: reviewKeys.mine(appId, userId) }),
      queryClient.invalidateQueries({ queryKey: profileKeys.reviews(userId) }),
    ]);
  };
}

export function useSaveReview(appId: string, userId: string) {
  const invalidate = useInvalidateReviewData(appId, userId);
  return useMutation({
    mutationFn: (draft: ReviewDraft) => repository().saveMine(appId, userId, draft),
    onSuccess: invalidate,
  });
}

export function useDeleteReview(appId: string, userId: string) {
  const invalidate = useInvalidateReviewData(appId, userId);
  return useMutation({
    mutationFn: () => repository().deleteMine(appId, userId),
    onSuccess: invalidate,
  });
}
