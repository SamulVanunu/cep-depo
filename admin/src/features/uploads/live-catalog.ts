import { STORAGE_CALL_TIMEOUT_MS } from './cleanup-config';

/**
 * Catalog references are the set of Storage objects the published catalog
 * still serves. They come from three sources that must all be honoured:
 *
 *   * the live database rows (checked separately by `cleanup_asset_is_referenced`);
 *   * the immutable `releases/{id}/apps.json` documents of the retained
 *     generations named by the PostgreSQL pointer;
 *   * the legacy root `apps.json`, kept for installs that never committed a
 *     release-based publish.
 *
 * The mutable root `manifest.json` is deliberately not read. It is a legacy
 * cache, and trusting it would let a stale or overwritten pointer hide a live
 * reference. Every transport, timeout, JSON or shape error throws so the
 * worker retries instead of deleting a possibly referenced object.
 */

export const CATALOG_BUCKET = 'catalog' as const;

const LEGACY_APPS_PATH = 'apps.json';
const RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type LiveCatalogClient = Readonly<{
  storage: Readonly<{
    from(bucket: string): Readonly<{
      download(path: string): Promise<Readonly<{ data: unknown; error: unknown }>>;
    }>;
  }>;
}>;

/**
 * The subset of `public.get_catalog_pointer()` the cleanup reader needs.
 * `retainedFromGeneration` is computed in PostgreSQL and is the only
 * retention window source; the reader never re-derives it.
 */
export type CatalogPointer = Readonly<{
  generation: number;
  releaseId: string | null;
  retainedFromGeneration: number;
  reconciliationRequired: boolean;
}>;

export type CatalogReferenceSources = Readonly<{
  pointer(): Promise<CatalogPointer>;
  /** Release ids whose generations fall inside the retained window. */
  retainedReleases(fromGeneration: number): Promise<readonly string[]>;
  /** Whether the publish history knows this release id at all. */
  releaseExists(releaseId: string): Promise<boolean>;
}>;

export type ReadCatalogReferenceOptions = Readonly<{
  timeoutMs?: number;
  sources: CatalogReferenceSources;
}>;

type RecordLike = Readonly<Record<string, unknown>>;

/**
 * References are keyed by both bucket and path. The same Storage path can
 * exist in more than one bucket, and a path-only set would let one bucket's
 * reference silently protect an object in another.
 */
export function catalogReferenceKey(bucket: string, path: string): string {
  return `${bucket}\u0000${path}`;
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, statusCode, message } = error as Readonly<{
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  }>;
  if (status === 404 || statusCode === 404 || statusCode === '404') return true;
  return (
    typeof message === 'string' &&
    /not found|not_found|no such key|does not exist/i.test(message)
  );
}

async function textOf(data: unknown, path: string): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  if (isRecord(data) && typeof data.text === 'function') {
    return (data.text as () => Promise<string>)();
  }
  throw new Error(`Katalog dosyası okunamadı: ${path}.`);
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Katalog dosyası geçerli JSON değil: ${path}.`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Katalog okuma zaman aşımı (${timeoutMs} ms).`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function downloadText(
  client: LiveCatalogClient,
  path: string,
): Promise<string> {
  const { data, error } = await client.storage.from(CATALOG_BUCKET).download(path);
  if (error) {
    if (isMissingObject(error)) {
      throw new Error(`Katalog dosyası bulunamadı: ${path}.`);
    }
    throw new Error(`Katalog dosyası okunamadı: ${path}.`);
  }
  return textOf(data, path);
}

function keysFromApps(document: unknown, appsPath: string): Set<string> {
  if (!isRecord(document) || !Array.isArray(document.apps)) {
    throw new Error(`Katalog ${appsPath} dosyasında apps dizisi yok.`);
  }

  const keys = new Set<string>();
  for (const entry of document.apps) {
    if (!isRecord(entry)) continue;

    for (const [field, bucket] of [
      ['apk_path', 'apks'],
      ['icon_path', 'app-assets'],
    ] as const) {
      const value = entry[field];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string') {
        throw new Error(
          `Katalog ${appsPath} dosyasındaki ${field} geçerli bir yol değil.`,
        );
      }
      keys.add(catalogReferenceKey(bucket, value));
    }
  }

  return keys;
}

async function readReleaseKeys(
  client: LiveCatalogClient,
  releaseId: string,
): Promise<Set<string>> {
  const appsPath = `releases/${releaseId}/apps.json`;
  const text = await downloadText(client, appsPath);
  return keysFromApps(parseJson(text, appsPath), appsPath);
}

/**
 * Before release-based publishing the catalog lived at the bucket root. A
 * missing legacy document is valid once generation zero is the truth; a
 * document that exists but cannot be parsed is not.
 */
async function readLegacyKeys(
  client: LiveCatalogClient,
): Promise<Set<string> | null> {
  const { data, error } = await client
    .storage.from(CATALOG_BUCKET)
    .download(LEGACY_APPS_PATH);
  if (error) {
    if (isMissingObject(error)) return null;
    throw new Error(`Katalog dosyası okunamadı: ${LEGACY_APPS_PATH}.`);
  }

  return keysFromApps(
    parseJson(await textOf(data, LEGACY_APPS_PATH), LEGACY_APPS_PATH),
    LEGACY_APPS_PATH,
  );
}

/**
 * Resolves every catalog reference key `(bucket, path)` the published catalog
 * still serves.
 *
 * Generation zero reads only the legacy root `apps.json`. A non-zero
 * generation reads the retained immutable release documents plus the legacy
 * root document when it exists. The manifest is never fetched. Any failed read
 * throws; the worker turns that into a retry and never deletes Storage.
 */
export async function readCatalogReferenceKeys(
  client: LiveCatalogClient,
  options: ReadCatalogReferenceOptions,
): Promise<ReadonlySet<string>> {
  const timeoutMs = options.timeoutMs ?? STORAGE_CALL_TIMEOUT_MS;

  return withTimeout(
    (async () => {
      const pointer = await options.sources.pointer();

      if (pointer.reconciliationRequired) {
        throw new Error(
          'Katalog mutabakatı gerekli; silme yapılmadı.',
        );
      }

      const keys = new Set<string>();

      if (pointer.generation > 0) {
        if (
          pointer.releaseId === null ||
          !RELEASE_ID_PATTERN.test(pointer.releaseId)
        ) {
          throw new Error('Katalog pointer geçerli bir yayın kimliği taşımıyor.');
        }
        if (
          !Number.isSafeInteger(pointer.retainedFromGeneration) ||
          pointer.retainedFromGeneration < 0
        ) {
          throw new Error('Katalog saklama penceresi geçersiz.');
        }

        const releases = await options.sources.retainedReleases(
          pointer.retainedFromGeneration,
        );
        const uniqueReleases = [...new Set(releases)];

        if (uniqueReleases.length === 0) {
          throw new Error(
            'Katalog pointer yayın gösteriyor ama saklanan release bulunamadı; silme yapılmadı.',
          );
        }

        for (const releaseId of uniqueReleases) {
          if (!RELEASE_ID_PATTERN.test(releaseId)) {
            throw new Error('Katalog geçmişinde geçersiz yayın kimliği var.');
          }
          const releaseKeys = await readReleaseKeys(client, releaseId);
          for (const key of releaseKeys) keys.add(key);
        }
      }

      // The legacy document protects installs upgraded from the root-era
      // catalog even after a release exists. It is additive, never a fallback
      // that replaces the release documents.
      const legacy = await readLegacyKeys(client);
      if (legacy !== null) {
        for (const key of legacy) keys.add(key);
      }

      return keys;
    })(),
    timeoutMs,
  );
}

/**
 * The independent worker-side retention answer for a catalog release.
 *
 * The SQL seal (`cleanup_asset_is_referenced`) is the authority because it
 * reads under the global advisory lock. This function is the second,
 * deliberately redundant read: if the two ever disagree the worker must not
 * delete, so every error, an active reconciliation and any release the ledger
 * cannot place all fail closed by reporting `true` (retained).
 */
export async function isCatalogReleaseRetained(
  releaseId: string,
  sources: CatalogReferenceSources,
): Promise<boolean> {
  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    throw new Error('Katalog release kimliği geçersiz.');
  }

  const pointer = await sources.pointer();

  if (pointer.reconciliationRequired) {
    throw new Error('Katalog mutabakatı gerekli; silme yapılmadı.');
  }

  // No release-based publish has happened yet, so no release is provably
  // outside the window.
  if (pointer.generation === 0) return true;
  if (releaseId === pointer.releaseId) return true;

  if (
    !Number.isSafeInteger(pointer.retainedFromGeneration) ||
    pointer.retainedFromGeneration < 0
  ) {
    throw new Error('Katalog saklama penceresi geçersiz.');
  }

  const retained = await sources.retainedReleases(
    pointer.retainedFromGeneration,
  );
  if (retained.includes(releaseId)) return true;

  // A release id the publish history has never seen is not provably safe to
  // delete: retain it and let the retry/quarantine path keep it.
  if (!(await sources.releaseExists(releaseId))) return true;

  return false;
}

/**
 * The asset-bucket half of the live-catalog check. The `catalog` bucket is
 * refused outright: this function collects `apks`/`app-assets` keys from the
 * release documents, so a catalog path would silently answer `false` and a
 * wrong refactor could exempt release documents from every reference check.
 */
export async function isLiveCatalogReference(
  bucket: string,
  path: string,
  keys: () => Promise<ReadonlySet<string>>,
): Promise<boolean> {
  if (bucket === CATALOG_BUCKET) {
    throw new Error('Katalog bucket\'ı canlı katalog referans kontrolüne verilemez.');
  }
  // Drafts never appear in the catalog; the worker already filters them.
  if (bucket === 'apk-drafts') return false;

  return (await keys()).has(catalogReferenceKey(bucket, path));
}
