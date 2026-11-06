export type StorageObjectState = 'present' | 'missing' | 'unknown';

export type StorageObjectCheck = Readonly<{
  state: StorageObjectState;
  /** Storage `lastModified`, when the object is present. */
  lastModified: string | null;
  /** Storage object version captured by the enqueue trigger, when present. */
  version: string | null;
}>;

/**
 * The subset of the Supabase client this module needs. Keeping it structural
 * lets the tests pass a tiny fake and keeps the check free of `server-only`.
 */
export type StorageClientLike = Readonly<{
  storage: Readonly<{
    from(bucket: string): Readonly<{
      info(path: string): Promise<Readonly<{
        data: Readonly<{ lastModified?: string | null; version?: string | null }> | null;
        error: unknown;
      }>>;
    }>;
  }>;
}>;

/**
 * Storage answers `object/info` for a missing key with HTTP 400 and
 * "Object not found" (verified against the local API), not 404. Any other
 * failure — transport, 5xx, 401/403, an unrecognised 400 — must fail closed as
 * `unknown`, because requeueing a job whose object still exists is safe, while
 * requeueing one whose object is gone is not.
 */
function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, message } = error as Readonly<{ status?: unknown; message?: unknown }>;
  if (status === 404) return true;
  return (
    status === 400 &&
    typeof message === 'string' &&
    /not found|no such key/i.test(message)
  );
}

/**
 * Reads the Storage state for a queued object. This never deletes: deletion is
 * the worker's job, and the admin panel must not race it.
 */
export async function checkCleanupObject(
  client: StorageClientLike,
  bucket: string,
  path: string,
): Promise<StorageObjectCheck> {
  try {
    const { data, error } = await client.storage.from(bucket).info(path);
    if (!error) {
      return {
        state: 'present',
        lastModified: data?.lastModified ?? null,
        version: data?.version ?? null,
      };
    }
    return {
      state: isMissingObject(error) ? 'missing' : 'unknown',
      lastModified: null,
      version: null,
    };
  } catch (error) {
    return {
      state: isMissingObject(error) ? 'missing' : 'unknown',
      lastModified: null,
      version: null,
    };
  }
}
