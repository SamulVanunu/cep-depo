import type { Database } from '../../types/database.types';
import type { AccountReview, Profile } from './profile.types';

export type ProfileRow = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'user_id' | 'username' | 'avatar_path' | 'status'
>;

export type AccountReviewRow = {
  id: string;
  rating: number;
  body: string | null;
  updated_at: string;
  app: { slug: string; title: string };
};

const INVALID_PROFILE_DATA = 'Profil verisi eksik veya geçersiz.';

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(INVALID_PROFILE_DATA);
  }
  return value;
}

export function mapProfile(row: ProfileRow): Profile {
  if (row.status !== 'active' && row.status !== 'suspended') {
    throw new Error(INVALID_PROFILE_DATA);
  }

  return Object.freeze({
    userId: requiredString(row.user_id),
    username: requiredString(row.username),
    avatarPath: row.avatar_path,
    status: row.status,
  });
}

export function mapAccountReview(row: AccountReviewRow): AccountReview {
  if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5) {
    throw new Error(INVALID_PROFILE_DATA);
  }

  return Object.freeze({
    id: requiredString(row.id),
    appSlug: requiredString(row.app?.slug),
    appTitle: requiredString(row.app?.title),
    rating: row.rating,
    body: row.body,
    updatedAt: requiredString(row.updated_at),
  });
}
