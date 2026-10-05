import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';
import {
  mapAccountReview,
  mapProfile,
  type AccountReviewRow,
  type ProfileRow,
} from './profile.mapper';
import type { AccountReview, Profile } from './profile.types';

type ProfileClient = SupabaseClient<Database>;

export class ProfileRepositoryError extends Error {
  readonly code: 'usernameTaken' | 'unknown';

  constructor(message: string, code: ProfileRepositoryError['code']) {
    super(message);
    this.name = 'ProfileRepositoryError';
    this.code = code;
  }
}

export type ProfileRepository = {
  getMine(userId: string): Promise<Profile | null>;
  updateUsername(userId: string, username: string): Promise<Profile>;
  updateAvatarPath(userId: string, avatarPath: string | null): Promise<Profile>;
  listMyReviews(userId: string): Promise<readonly AccountReview[]>;
};

function repositoryError(error: { code?: string } | null, operation: 'username' | 'other') {
  if (operation === 'username' && error?.code === '23505') {
    return new ProfileRepositoryError('Bu kullanıcı adı kullanılıyor.', 'usernameTaken');
  }
  return new ProfileRepositoryError(
    'Profil işlemi tamamlanamadı. Lütfen tekrar deneyin.',
    'unknown',
  );
}

const PROFILE_FIELDS = 'user_id, username, avatar_path, status';

export function createProfileRepository(client: ProfileClient): ProfileRepository {
  return {
    async getMine(userId) {
      const { data, error } = await client
        .from('profiles')
        .select(PROFILE_FIELDS)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw repositoryError(error, 'other');
      return data ? mapProfile(data as ProfileRow) : null;
    },

    async updateUsername(userId, username) {
      const { data, error } = await client
        .from('profiles')
        .update({ username: username.trim() })
        .eq('user_id', userId)
        .select(PROFILE_FIELDS)
        .single();
      if (error || !data) throw repositoryError(error, 'username');
      return mapProfile(data as ProfileRow);
    },

    async updateAvatarPath(userId, avatarPath) {
      const { data, error } = await client
        .from('profiles')
        .update({ avatar_path: avatarPath })
        .eq('user_id', userId)
        .select(PROFILE_FIELDS)
        .single();
      if (error || !data) throw repositoryError(error, 'other');
      return mapProfile(data as ProfileRow);
    },

    async listMyReviews(userId) {
      const { data, error } = await client
        .from('reviews')
        .select('id, rating, body, updated_at, app:apps!reviews_app_id_fkey(slug, title)')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw repositoryError(error, 'other');
      return Object.freeze(
        ((data ?? []) as unknown as AccountReviewRow[]).map(mapAccountReview),
      );
    },
  };
}
