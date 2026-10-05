import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getSupabaseClient } from '../../lib/supabase';
import { createProfileRepository } from './profile.repository';

export const profileKeys = {
  all: ['profile'] as const,
  mine: (userId: string) => [...profileKeys.all, 'mine', userId] as const,
  reviews: (userId: string) => [...profileKeys.all, 'reviews', userId] as const,
};

const publicReviewKeys = ['reviews'] as const;

function repository() {
  return createProfileRepository(getSupabaseClient());
}

export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.mine(userId ?? ''),
    queryFn: () => repository().getMine(userId!),
    enabled: Boolean(userId),
  });
}

export function useMyReviews(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.reviews(userId ?? ''),
    queryFn: () => repository().listMyReviews(userId!),
    enabled: Boolean(userId),
  });
}

export function useUpdateUsername(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => repository().updateUsername(userId, username),
    onSuccess: profile => {
      queryClient.setQueryData(profileKeys.mine(userId), profile);
      void queryClient.invalidateQueries({ queryKey: publicReviewKeys });
    },
  });
}

export function useUpdateAvatarPath(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (avatarPath: string | null) =>
      repository().updateAvatarPath(userId, avatarPath),
    onSuccess: profile => {
      queryClient.setQueryData(profileKeys.mine(userId), profile);
      void queryClient.invalidateQueries({ queryKey: publicReviewKeys });
    },
  });
}
