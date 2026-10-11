import { describe, expect, it, vi } from 'vitest';

import {
  deleteHiddenReview,
  setReviewVisibility,
  type ReviewActionDependencies,
} from './review-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const reviewId = 'a2000000-0000-4000-8000-000000000001';

function dependencies(overrides: Partial<ReviewActionDependencies> = {}): ReviewActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    getStatus: vi.fn(async () => 'hidden' as const),
    setStatusRpc: vi.fn(async () => ({ error: null })),
    deleteRpc: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('review moderation', () => {
  it('requires hidden status before permanent review deletion', async () => {
    const deleteRpc = vi.fn();
    const result = await deleteHiddenReview(
      reviewId,
      dependencies({ getStatus: vi.fn(async () => 'visible' as const), deleteRpc }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(deleteRpc).not.toHaveBeenCalled();
  });

  it('re-fetches hidden status and deletes through the audited RPC', async () => {
    const deleteRpc = vi.fn(async () => ({ error: null }));
    const result = await deleteHiddenReview(reviewId, dependencies({ deleteRpc }));

    expect(result).toEqual({ ok: true, data: null });
    expect(deleteRpc).toHaveBeenCalledWith(actorId, reviewId);
  });

  it('changes visibility without accepting comment body metadata', async () => {
    const setStatusRpc = vi.fn(async () => ({ error: null }));
    const result = await setReviewVisibility(reviewId, 'hidden', dependencies({ setStatusRpc }));

    expect(result).toEqual({ ok: true, data: null });
    expect(setStatusRpc).toHaveBeenCalledWith(actorId, reviewId, 'hidden');
    expect(JSON.stringify(setStatusRpc.mock.calls)).not.toContain('body');
  });
});
