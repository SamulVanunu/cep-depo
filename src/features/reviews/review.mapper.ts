import type { RatingSummary, Review } from './review.types';

export type RatingSummaryRow = {
  average_rating: number | null;
  review_count: number | null;
};

export type ReviewRow = {
  id: string;
  app_id: string;
  user_id: string;
  rating: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  profile: { username: string; avatar_path: string | null };
};

const INVALID_REVIEW_DATA = 'Yorum verisi eksik veya geçersiz.';

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(INVALID_REVIEW_DATA);
  }
  return value;
}

function validRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function mapRatingSummary(row: RatingSummaryRow): RatingSummary {
  const count = row.review_count;
  const average = row.average_rating;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 0 ||
    (average !== null &&
      (typeof average !== 'number' || !Number.isFinite(average) || average < 1 || average > 5))
  ) {
    throw new Error(INVALID_REVIEW_DATA);
  }
  return Object.freeze({ average, count });
}

export function mapReview(row: ReviewRow): Review {
  if (!validRating(row.rating)) throw new Error(INVALID_REVIEW_DATA);
  return Object.freeze({
    id: requiredString(row.id),
    appId: requiredString(row.app_id),
    userId: requiredString(row.user_id),
    username: requiredString(row.profile?.username),
    avatarPath: row.profile?.avatar_path ?? null,
    rating: row.rating,
    body: row.body,
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  });
}
