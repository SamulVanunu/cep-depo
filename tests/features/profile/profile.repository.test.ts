import type { SupabaseClient } from '@supabase/supabase-js';

import { createProfileRepository } from '../../../src/features/profile/profile.repository';
import type { Database } from '../../../src/types/database.types';

type ProfileClient = SupabaseClient<Database>;

const profileRow = {
  user_id: 'user-1',
  username: 'Çağrı_Öz',
  avatar_path: 'user-1/avatar.webp',
  status: 'active' as const,
};

function createClient() {
  const maybeSingle = jest.fn().mockResolvedValue({ data: profileRow, error: null });
  const single = jest.fn().mockResolvedValue({ data: profileRow, error: null });
  const order = jest.fn().mockResolvedValue({ data: [], error: null });
  let eq: jest.Mock;
  let select: jest.Mock;
  eq = jest.fn(() => ({ maybeSingle, single, order, select }));
  select = jest.fn(() => ({ eq, single, order }));
  const update = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select, update }));

  return {
    client: { from } as unknown as ProfileClient,
    from,
    select,
    update,
    eq,
    maybeSingle,
    single,
    order,
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

describe('ProfileRepository', () => {
  it('reads and maps only the public own-profile contract', async () => {
    const mock = createClient();
    const repository = createProfileRepository(mock.client);

    await expect(repository.getMine('user-1')).resolves.toEqual({
      userId: 'user-1',
      username: 'Çağrı_Öz',
      avatarPath: 'user-1/avatar.webp',
      status: 'active',
    });
    expect(mock.from).toHaveBeenCalledWith('profiles');
    expect(mock.select).toHaveBeenCalledWith('user_id, username, avatar_path, status');
    expect(mock.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('returns null when the own profile does not exist', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(createProfileRepository(mock.client).getMine('user-1')).resolves.toBeNull();
  });

  it('updates only a trimmed username and cannot mutate user_id or status', async () => {
    const mock = createClient();
    const repository = createProfileRepository(mock.client);

    await expect(repository.updateUsername('user-1', '  Yeni.Ad  ')).resolves.toEqual({
      userId: 'user-1',
      username: 'Çağrı_Öz',
      avatarPath: 'user-1/avatar.webp',
      status: 'active',
    });
    expect(mock.update).toHaveBeenCalledWith({ username: 'Yeni.Ad' });
    expect(mock.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mock.select).toHaveBeenCalledWith('user_id, username, avatar_path, status');
  });

  it('maps a case-insensitive username collision without exposing database details', async () => {
    const mock = createClient();
    mock.single.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate Profiles_Username_Key value SecretUser' },
    });

    await expect(
      createProfileRepository(mock.client).updateUsername('user-1', 'secretuser'),
    ).rejects.toMatchObject({
      code: 'usernameTaken',
      message: 'Bu kullanıcı adı kullanılıyor.',
    });
  });

  it('updates only avatar_path, including removal', async () => {
    const mock = createClient();
    const repository = createProfileRepository(mock.client);

    await repository.updateAvatarPath('user-1', null);

    expect(mock.update).toHaveBeenCalledWith({ avatar_path: null });
    expect(mock.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('lists own review history newest first without auth metadata', async () => {
    const mock = createClient();
    mock.order.mockResolvedValue({
      data: [
        {
          id: 'review-2',
          rating: 5,
          body: 'Çok iyi',
          updated_at: '2026-10-02T12:00:00Z',
          app: { slug: 'uygulama-iki', title: 'Uygulama İki' },
        },
        {
          id: 'review-1',
          rating: 3,
          body: null,
          updated_at: '2026-10-01T12:00:00Z',
          app: { slug: 'uygulama-bir', title: 'Uygulama Bir' },
        },
      ],
      error: null,
    });
    const repository = createProfileRepository(mock.client);

    const reviews = await repository.listMyReviews('user-1');

    expect(mock.from).toHaveBeenCalledWith('reviews');
    expect(mock.select).toHaveBeenCalledWith(
      'id, rating, body, updated_at, app:apps!reviews_app_id_fkey(slug, title)',
    );
    expect(mock.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mock.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(reviews).toEqual([
      {
        id: 'review-2',
        appSlug: 'uygulama-iki',
        appTitle: 'Uygulama İki',
        rating: 5,
        body: 'Çok iyi',
        updatedAt: '2026-10-02T12:00:00Z',
      },
      {
        id: 'review-1',
        appSlug: 'uygulama-bir',
        appTitle: 'Uygulama Bir',
        rating: 3,
        body: null,
        updatedAt: '2026-10-01T12:00:00Z',
      },
    ]);
    expect(JSON.stringify(reviews)).not.toContain('email');
    expect(JSON.stringify(reviews)).not.toContain('metadata');
  });

  it('sanitizes unknown data errors', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'policy profiles_owner leaked-secret' },
    });

    const error = await rejectionOf(createProfileRepository(mock.client).getMine('user-1'));

    expect(error.message).toBe('Profil işlemi tamamlanamadı. Lütfen tekrar deneyin.');
    expect(error.message).not.toContain('profiles_owner');
    expect(error.message).not.toContain('leaked-secret');
  });
});
