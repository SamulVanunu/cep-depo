import { ActionException } from '../../server/errors/action-error';
import type { ApkByteSource } from './apk-manifest';
import { storageAuthHeaders } from './storage-auth-headers';

/**
 * Creates an `ApkByteSource` backed by Supabase Storage range requests.
 *
 * Only the requested byte window is ever held in memory. A response that is
 * not a partial-content reply, a content range for another window, a short
 * body, or a body with extra bytes is treated as a temporary storage failure
 * so verification never consumes truncated or unrelated data.
 */
export function createStorageApkSource(input: Readonly<{
  supabaseUrl: string;
  secretKey: string;
  path: string;
  size: number;
  fetchImpl?: typeof fetch;
}>): ApkByteSource {
  const {
    supabaseUrl,
    secretKey,
    path,
    size,
    fetchImpl = fetch,
  } = input;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${supabaseUrl}/storage/v1/object/authenticated/apk-drafts/${encodedPath}`;

  return {
    size,
    async read(start, endExclusive) {
      if (
        size <= 0 ||
        !Number.isInteger(start) ||
        !Number.isInteger(endExclusive) ||
        start < 0 ||
        endExclusive <= start ||
        endExclusive > size
      ) {
        throw new ActionException('VALIDATION');
      }

      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            ...storageAuthHeaders(secretKey),
            Range: `bytes=${start}-${endExclusive - 1}`,
            'Accept-Encoding': 'identity',
          },
          cache: 'no-store',
        });
      } catch {
        throw new ActionException('TEMPORARY');
      }

      if (response.status !== 206) {
        await response.body?.cancel().catch(() => undefined);
        throw new ActionException('TEMPORARY');
      }

      // A 206 for another offset or another object version would feed the
      // parser and the digest bytes that were not requested. Only an exact
      // `bytes start-end/total` for this request is accepted.
      const contentRange = response.headers.get('Content-Range');
      const match = contentRange ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange.trim()) : null;
      if (
        !match ||
        Number(match[1]) !== start ||
        Number(match[2]) !== endExclusive - 1 ||
        Number(match[3]) !== size
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new ActionException('TEMPORARY');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new ActionException('TEMPORARY');

      const expected = endExclusive - start;
      const out = new Uint8Array(expected);
      let written = 0;
      try {
        while (written < expected) {
          const { done, value } = await reader.read();
          if (done) break;
          if (written + value.length > expected) {
            await reader.cancel().catch(() => undefined);
            throw new ActionException('TEMPORARY');
          }
          out.set(value, written);
          written += value.length;
        }

        if (written === expected) {
          // One more read catches a server that keeps sending past the range.
          const extra = await reader.read();
          if (!extra.done) {
            await reader.cancel().catch(() => undefined);
            throw new ActionException('TEMPORARY');
          }
        }
      } catch (error) {
        if (error instanceof ActionException) throw error;
        throw new ActionException('TEMPORARY');
      }

      if (written !== expected) {
        await reader.cancel().catch(() => undefined);
        throw new ActionException('TEMPORARY');
      }

      return out;
    },
  };
}
