import type { SupabaseClient } from '@supabase/supabase-js';

import { createReviewRepository } from '../../../src/features/reviews/review.repository';
import type { Database } from '../../../src/types/database.types';

type ReviewClient = SupabaseClient<Database>;

const reviewRow = {
  id: 'review-1',
  app_id: 'app-1',
  user_id: 'user-1',
  rating: 4,
  body: null,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-02T10:00:00Z',
  profile: { username: 'User.One', avatar_path: null },
};

function createClient() {
  const maybeSingle = jest.fn().mockResolvedValue({ data: reviewRow, error: null });
  const single = jest.fn().mockResolvedValue({ data: reviewRow, error: null });
  const secondOrder = jest.fn().mockResolvedValue({ data: [reviewRow], error: null });
  const order = jest.fn(() => ({ order: secondOrder }));
  let eq: jest.Mock;
  let select: jest.Mock;
  eq = jest.fn(() => ({ eq, maybeSingle, order, select, single }));
  select = jest.fn(() => ({ eq, maybeSingle, order, single }));
  const insert = jest.fn(() => ({ select }));
  const update = jest.fn(() => ({ eq }));
  const deleteQuery = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ delete: deleteQuery, insert, select, update }));

  return {
    client: { from } as unknown as ReviewClient,
    from,
    select,
    eq,
    maybeSingle,
    single,
    order,
    secondOrder,
    insert,
    update,
    deleteQuery,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('İşlemin hata vermesi bekleniyordu.');
}

describe('ReviewRepository', () => {
  it('returns the zero-review summary when the view has no row', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(createReviewRepository(mock.client).getSummary('app-1')).resolves.toEqual({
      average: null,
      count: 0,
    });
    expect(mock.from).toHaveBeenCalledWith('review_rating_summaries');
    expect(mock.select).toHaveBeenCalledWith('average_rating, review_count');
    expect(mock.eq).toHaveBeenCalledWith('app_id', 'app-1');
  });

  it('lists only visible reviews newest first with deterministic ID tie-breaking', async () => {
    const mock = createClient();
    const repository = createReviewRepository(mock.client);

    await expect(repository.listVisible('app-1')).resolves.toHaveLength(1);
    expect(mock.eq).toHaveBeenCalledWith('app_id', 'app-1');
    expect(mock.eq).toHaveBeenCalledWith('moderation_status', 'visible');
    expect(mock.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mock.secondOrder).toHaveBeenCalledWith('id', { ascending: true });
    expect(mock.select).toHaveBeenCalledWith(
      'id, app_id, user_id, rating, body, created_at, updated_at, profile:profiles!reviews_user_id_fkey(username, avatar_path)',
    );
  });

  it('scopes the current review by both app and current user', async () => {
    const mock = createClient();

    await createReviewRepository(mock.client).getMine('app-1', 'user-1');

    expect(mock.eq).toHaveBeenCalledWith('app_id', 'app-1');
    expect(mock.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mock.eq).toHaveBeenCalledWith('moderation_status', 'visible');
  });

  it('updates only rating and normalized body for an existing own review', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValueOnce({ data: { id: 'review-1' }, error: null });

    await createReviewRepository(mock.client).saveMine('app-1', 'user-1', {
      rating: 5,
      body: '  Çok iyi  ',
    });

    expect(mock.update).toHaveBeenCalledWith({ rating: 5, body: 'Çok iyi' });
    expect(mock.eq).toHaveBeenCalledWith('app_id', 'app-1');
    expect(mock.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('inserts only app, current user, rating and null-normalized body', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await createReviewRepository(mock.client).saveMine('app-1', 'user-1', {
      rating: 3,
      body: '\t\n ',
    });

    expect(mock.insert).toHaveBeenCalledWith({
      app_id: 'app-1',
      user_id: 'user-1',
      rating: 3,
      body: null,
    });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('accepts a trimmed 2000-character optional body', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const body = 'a'.repeat(2000);

    await createReviewRepository(mock.client).saveMine('app-1', 'user-1', {
      rating: 4,
      body: ` ${body} `,
    });

    expect(mock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ body }),
    );
  });

  it.each([
    ['ab', 'Yorum boş bırakılmalı veya en az 3 karakter olmalıdır.'],
    ['a'.repeat(2001), 'Yorum en fazla 2000 karakter olabilir.'],
  ])('rejects invalid non-empty body length', async (body, message) => {
    const mock = createClient();

    await expect(
      createReviewRepository(mock.client).saveMine('app-1', 'user-1', {
        rating: 4,
        body,
      }),
    ).rejects.toThrow(message);
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });

  it.each([0, 6, 2.5] as const)('rejects rating %s before a write', async rating => {
    const mock = createClient();

    await expect(
      createReviewRepository(mock.client).saveMine('app-1', 'user-1', {
        rating: rating as 1,
        body: '',
      }),
    ).rejects.toThrow('Puan 1 ile 5 arasında olmalıdır.');
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('deletes only the current user review for the target app', async () => {
    const mock = createClient();
    mock.eq.mockReturnValueOnce({ eq: mock.eq }).mockReturnValueOnce({ error: null });

    await createReviewRepository(mock.client).deleteMine('app-1', 'user-1');

    expect(mock.deleteQuery).toHaveBeenCalledTimes(1);
    expect(mock.eq).toHaveBeenNthCalledWith(1, 'app_id', 'app-1');
    expect(mock.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1');
  });

  it('sanitizes database failures', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'reviews policy secret detail' },
    });

    const error = await rejectionOf(
      createReviewRepository(mock.client).getMine('app-1', 'user-1'),
    );

    expect(error.message).toBe('Yorum işlemi tamamlanamadı. Lütfen tekrar deneyin.');
    expect(error.message).not.toContain('policy');
    expect(error.message).not.toContain('secret');
  });
});
