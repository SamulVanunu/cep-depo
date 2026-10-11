'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '../../server/auth/require-admin';
import type { ActionResult } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';

type Actor = Readonly<{ userId: string }>;
type ReviewStatus = 'visible' | 'hidden';

export type ReviewActionDependencies = Readonly<{
  authorize(): Promise<Actor>;
  getStatus(reviewId: string): Promise<ReviewStatus | null>;
  setStatusRpc(actorId: string, reviewId: string, status: ReviewStatus): Promise<{ error: unknown | null }>;
  deleteRpc(actorId: string, reviewId: string): Promise<{ error: unknown | null }>;
  revalidate?(path: string): void;
}>;

function defaultDependencies(): ReviewActionDependencies {
  let identity: Awaited<ReturnType<typeof requireAdmin>> | null = null;
  let client: ReturnType<typeof import('../../server/supabase/admin-client')['getAdminClient']> | null = null;
  async function authorize() {
    identity ??= await requireAdmin(undefined, { mutation: true });
    return identity;
  }
  async function database() {
    const actor = await authorize();
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    client ??= getAdminClient(actor);
    return client;
  }
  return {
    authorize,
    async getStatus(reviewId) {
      const result = await (await database()).from('reviews').select('moderation_status').eq('id', reviewId).maybeSingle();
      if (result.error) throw result.error;
      return result.data?.moderation_status ?? null;
    },
    async setStatusRpc(actorId, reviewId, status) {
      return (await database()).rpc('admin_set_review_status', {
        p_actor_id: actorId,
        p_review_id: reviewId,
        p_status: status,
      });
    },
    async deleteRpc(actorId, reviewId) {
      return (await database()).rpc('admin_delete_hidden_review', {
        p_actor_id: actorId,
        p_review_id: reviewId,
      });
    },
    revalidate: revalidatePath,
  };
}

export async function setReviewVisibility(
  reviewId: string,
  status: ReviewStatus,
  dependencies: ReviewActionDependencies = defaultDependencies(),
): Promise<ActionResult<null>> {
  try {
    const actor = await dependencies.authorize();
    const id = z.string().uuid().parse(reviewId);
    const nextStatus = z.enum(['visible', 'hidden']).parse(status);
    const result = await dependencies.setStatusRpc(actor.userId, id, nextStatus);
    if (result.error) throw result.error;
    dependencies.revalidate?.('/reviews');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}

export async function deleteHiddenReview(
  reviewId: string,
  dependencies: ReviewActionDependencies = defaultDependencies(),
): Promise<ActionResult<null>> {
  try {
    const actor = await dependencies.authorize();
    const id = z.string().uuid().parse(reviewId);
    if ((await dependencies.getStatus(id)) !== 'hidden') throw new ActionException('CONFLICT');
    const result = await dependencies.deleteRpc(actor.userId, id);
    if (result.error) throw result.error;
    dependencies.revalidate?.('/reviews');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error instanceof z.ZodError ? new ActionException('VALIDATION') : error) };
  }
}

export async function setReviewVisibilityAction(reviewId: string, status: ReviewStatus) {
  return setReviewVisibility(reviewId, status);
}

export async function deleteHiddenReviewAction(reviewId: string) {
  return deleteHiddenReview(reviewId);
}
