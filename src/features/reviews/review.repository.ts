import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';
import {
  mapRatingSummary,
  mapReview,
  type RatingSummaryRow,
  type ReviewRow,
} from './review.mapper';
import type { RatingSummary, Review, ReviewDraft } from './review.types';

type ReviewClient = SupabaseClient<Database>;

const REVIEW_FIELDS =
  'id, app_id, user_id, rating, body, created_at, updated_at, profile:profiles!reviews_user_id_fkey(username, avatar_path)';

export type ReviewRepository = {
  getSummary(appId: string): Promise<RatingSummary>;
  listVisible(appId: string): Promise<readonly Review[]>;
  getMine(appId: string, userId: string): Promise<Review | null>;
  saveMine(appId: string, userId: string, draft: ReviewDraft): Promise<Review>;
  deleteMine(appId: string, userId: string): Promise<void>;
};

function safeError(): Error {
  return new Error('Yorum işlemi tamamlanamadı. Lütfen tekrar deneyin.');
}

function normalizeDraft(draft: ReviewDraft): { rating: number; body: string | null } {
  if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
    throw new Error('Puan 1 ile 5 arasında olmalıdır.');
  }
  const body = draft.body.trim();
  if (body.length > 500) throw new Error('Yorum en fazla 500 karakter olabilir.');
  return { rating: draft.rating, body: body || null };
}

export function createReviewRepository(client: ReviewClient): ReviewRepository {
  return {
    async getSummary(appId) {
      const { data, error } = await client
        .from('review_rating_summaries')
        .select('average_rating, review_count')
        .eq('app_id', appId)
        .maybeSingle();
      if (error) throw safeError();
      if (!data) return Object.freeze({ average: null, count: 0 });
      return mapRatingSummary(data as RatingSummaryRow);
    },

    async listVisible(appId) {
      const { data, error } = await client
        .from('reviews')
        .select(REVIEW_FIELDS)
        .eq('app_id', appId)
        .eq('moderation_status', 'visible')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });
      if (error) throw safeError();
      return Object.freeze(((data ?? []) as unknown as ReviewRow[]).map(mapReview));
    },

    async getMine(appId, userId) {
      const { data, error } = await client
        .from('reviews')
        .select(REVIEW_FIELDS)
        .eq('app_id', appId)
        .eq('user_id', userId)
        .eq('moderation_status', 'visible')
        .maybeSingle();
      if (error) throw safeError();
      return data ? mapReview(data as unknown as ReviewRow) : null;
    },

    async saveMine(appId, userId, draft) {
      const normalized = normalizeDraft(draft);
      const { data: existing, error: readError } = await client
        .from('reviews')
        .select('id')
        .eq('app_id', appId)
        .eq('user_id', userId)
        .eq('moderation_status', 'visible')
        .maybeSingle();
      if (readError) throw safeError();

      if (existing) {
        const { data, error } = await client
          .from('reviews')
          .update(normalized)
          .eq('app_id', appId)
          .eq('user_id', userId)
          .select(REVIEW_FIELDS)
          .single();
        if (error || !data) throw safeError();
        return mapReview(data as unknown as ReviewRow);
      }

      const { data, error } = await client
        .from('reviews')
        .insert({ app_id: appId, user_id: userId, ...normalized })
        .select(REVIEW_FIELDS)
        .single();
      if (error || !data) throw safeError();
      return mapReview(data as unknown as ReviewRow);
    },

    async deleteMine(appId, userId) {
      const { error } = await client
        .from('reviews')
        .delete()
        .eq('app_id', appId)
        .eq('user_id', userId);
      if (error) throw safeError();
    },
  };
}
