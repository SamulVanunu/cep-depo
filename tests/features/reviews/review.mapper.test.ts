import { mapRatingSummary, mapReview } from '../../../src/features/reviews/review.mapper';

describe('review mappers', () => {
  it('maps a nullable zero-review summary', () => {
    expect(mapRatingSummary({ average_rating: null, review_count: 0 })).toEqual({
      average: null,
      count: 0,
    });
  });

  it('maps the public profile projection without private metadata', () => {
    const review = mapReview({
      id: 'review-1',
      app_id: 'app-1',
      user_id: 'user-1',
      rating: 4,
      body: 'İşimi gördü.',
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
      profile: { username: 'Çağrı_Öz', avatar_path: 'user-1/avatar.webp' },
    });

    expect(review).toEqual({
      id: 'review-1',
      appId: 'app-1',
      userId: 'user-1',
      username: 'Çağrı_Öz',
      avatarPath: 'user-1/avatar.webp',
      rating: 4,
      body: 'İşimi gördü.',
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-10-02T10:00:00Z',
    });
    expect(JSON.stringify(review)).not.toContain('email');
    expect(JSON.stringify(review)).not.toContain('metadata');
  });

  it.each([0, 6, 2.5, Number.NaN])('rejects invalid rating %s', rating => {
    expect(() =>
      mapReview({
        id: 'review-1',
        app_id: 'app-1',
        user_id: 'user-1',
        rating,
        body: null,
        created_at: '2026-10-01T10:00:00Z',
        updated_at: '2026-10-01T10:00:00Z',
        profile: { username: 'User', avatar_path: null },
      }),
    ).toThrow('Yorum verisi eksik veya geçersiz.');
  });
});
