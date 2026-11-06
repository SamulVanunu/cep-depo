import { describe, expect, it, vi } from 'vitest';

import { checkCleanupObject, type StorageClientLike } from './cleanup-admin-storage';

type InfoResult = Readonly<{ data: unknown; error: unknown }>;

function clientReturning(result: InfoResult | Error) {
  const remove = vi.fn();
  const info = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const from = vi.fn(() => ({ info, remove }));
  return { client: { storage: { from } } as unknown as StorageClientLike, info, remove, from };
}

describe('checkCleanupObject', () => {
  it('reports a present object and its last modification time', async () => {
    const { client, from } = clientReturning({
      data: {
        size: 12,
        lastModified: '2026-11-04T13:00:00.000Z',
        version: 'b7000000-0000-4000-8000-000000000001',
      },
      error: null,
    });

    await expect(checkCleanupObject(client, 'app-assets', 'apps/a/icons/b.png')).resolves.toEqual({
      state: 'present',
      lastModified: '2026-11-04T13:00:00.000Z',
      version: 'b7000000-0000-4000-8000-000000000001',
    });
    expect(from).toHaveBeenCalledWith('app-assets');
  });

  it('reports a present object without a version as unproven identity', async () => {
    const { client } = clientReturning({
      data: { size: 12, lastModified: '2026-11-04T13:00:00.000Z' },
      error: null,
    });

    await expect(checkCleanupObject(client, 'app-assets', 'apps/a/icons/b.png')).resolves.toEqual({
      state: 'present',
      lastModified: '2026-11-04T13:00:00.000Z',
      version: null,
    });
  });

  it('treats the storage "Object not found" 400 as missing', async () => {
    const { client } = clientReturning({
      data: null,
      error: Object.assign(new Error('Object not found'), {
        name: 'StorageApiError',
        status: 400,
      }),
    });

    await expect(checkCleanupObject(client, 'app-assets', 'apps/a/icons/b.png')).resolves.toEqual({
      state: 'missing',
      lastModified: null,
      version: null,
    });
  });

  it('treats a 404 as missing', async () => {
    const { client } = clientReturning({
      data: null,
      error: Object.assign(new Error('not found'), { status: 404 }),
    });

    expect((await checkCleanupObject(client, 'app-assets', 'apps/a/icons/b.png')).state).toBe('missing');
  });

  it.each([
    ['a server error', Object.assign(new Error('boom'), { status: 500 })],
    ['an authorization error', Object.assign(new Error('denied'), { status: 401 })],
    ['an unrecognised 400', Object.assign(new Error('invalid path'), { status: 400 })],
    ['a thrown transport error', new Error('fetch failed')],
  ])('fails closed with unknown for %s', async (_label, error) => {
    const { client } = clientReturning(
      error instanceof Error && !('status' in error) ? error : { data: null, error },
    );

    expect((await checkCleanupObject(client, 'app-assets', 'apps/a/icons/b.png')).state).toBe('unknown');
  });

  it('never removes the object it inspects', async () => {
    const { client, remove } = clientReturning({
      data: { size: 1, version: 'v1' },
      error: null,
    });

    await checkCleanupObject(client, 'app-assets', 'apps/a/icons/b.png');

    expect(remove).not.toHaveBeenCalled();
  });
});
