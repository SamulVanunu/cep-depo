// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { ActionException } from '../../server/errors/action-error';
import { createStorageApkSource } from './storage-apk-source';

const supabaseUrl = 'https://project.test';
const secretKey = 'sb_secret_test';
const path = 'operations/a3000000-0000-4000-8000-000000000001/source.apk';
const size = 64;

function partial(body: Uint8Array<ArrayBuffer>, start: number, endExclusive: number, total = size): Response {
  return new Response(body, {
    status: 206,
    headers: { 'Content-Range': `bytes ${start}-${endExclusive - 1}/${total}` },
  });
}

function respond(body: Uint8Array<ArrayBuffer>, start: number, endExclusive: number): typeof fetch {
  return (async () => partial(body, start, endExclusive)) as typeof fetch;
}

function source(fetchImpl: typeof fetch, overrides: { path?: string; size?: number } = {}) {
  return createStorageApkSource({
    supabaseUrl,
    secretKey,
    path: overrides.path ?? path,
    size: overrides.size ?? size,
    fetchImpl,
  });
}

describe('createStorageApkSource', () => {
  it('requests an exact byte range with service auth and identity encoding', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([1, 2, 3, 4]), 0, 4));

    await source(fetchImpl as unknown as typeof fetch).read(0, 4);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `${supabaseUrl}/storage/v1/object/authenticated/apk-drafts/operations/a3000000-0000-4000-8000-000000000001/source.apk`,
    );
    expect(init.headers).toMatchObject({
      apikey: secretKey,
      Range: 'bytes=0-3',
      'Accept-Encoding': 'identity',
    });
    expect(init.cache).toBe('no-store');
  });

  it('uses a bearer token for a non sb_secret key', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([1]), 0, 1));

    await createStorageApkSource({
      supabaseUrl,
      secretKey: 'jwt-token',
      path,
      size,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).read(0, 1);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-token' });
    expect((init.headers as Record<string, string>).apikey).toBeUndefined();
  });

  it('encodes each path segment', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([1]), 0, 1));

    await source(fetchImpl as unknown as typeof fetch, {
      path: 'operations/a b/source.apk',
    }).read(0, 1);

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('/operations/a%20b/source.apk');
  });

  it('returns exactly the requested bytes on 206', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([9, 8, 7, 6]), 0, 4));

    const bytes = await source(fetchImpl as unknown as typeof fetch).read(0, 4);

    expect(Array.from(bytes)).toEqual([9, 8, 7, 6]);
  });

  it('accepts a 206 whose content range matches the request at an offset', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([5, 6]), 10, 12));

    const bytes = await source(fetchImpl as unknown as typeof fetch).read(10, 12);

    expect(Array.from(bytes)).toEqual([5, 6]);
  });

  it('rejects a short body with TEMPORARY instead of returning truncated data', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([1, 2]), 0, 4));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('rejects a 206 body that contains more bytes than requested', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([1, 2, 3, 4, 5]), 0, 4));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('rejects a 206 without a content range instead of trusting the body', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 }));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('rejects a 206 whose content range starts at another offset', async () => {
    const fetchImpl = vi.fn(async () => partial(new Uint8Array([1, 2, 3, 4]), 4, 8));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('rejects a 206 whose content range has another total size', async () => {
    const fetchImpl = vi.fn(async () => partial(new Uint8Array([1, 2, 3, 4]), 0, 4, size + 1));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('rejects a malformed content range', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 206,
      headers: { 'Content-Range': 'bytes 0-3/*' },
    }));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('rejects a 200 response that ignores Range without reading its body', async () => {
    let pulled = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 2;
        controller.enqueue(new Uint8Array(2));
      },
      cancel,
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
    // The full-object response is cancelled, never drained: one 200 could be
    // 50 MB of unrelated bytes.
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulled).toBeLessThanOrEqual(2);
  });

  it.each([500, 503, 416])('maps HTTP %i to TEMPORARY', async (status) => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status }));

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('maps a network failure to TEMPORARY', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(source(fetchImpl as unknown as typeof fetch).read(0, 4)).rejects.toMatchObject({
      code: 'TEMPORARY',
    });
  });

  it('rejects invalid ranges before fetching', async () => {
    const fetchImpl = vi.fn(respond(new Uint8Array([1]), 0, 1));
    const subject = source(fetchImpl as unknown as typeof fetch);

    await expect(subject.read(-1, 4)).rejects.toBeInstanceOf(ActionException);
    await expect(subject.read(4, 4)).rejects.toBeInstanceOf(ActionException);
    await expect(subject.read(0, size + 1)).rejects.toBeInstanceOf(ActionException);
    await expect(
      createStorageApkSource({
        supabaseUrl,
        secretKey,
        path,
        size: 0,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }).read(0, 1),
    ).rejects.toBeInstanceOf(ActionException);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
