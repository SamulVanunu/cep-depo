/**
 * Buckets the orphan sweeper may walk. The catalog is deliberately absent: its
 * immutable release documents are enqueued by the retention sweep, never by
 * folder discovery, and `admin_asset_cleanup_sweep_state.bucket` only accepts
 * these three values.
 */
export const CLEANUP_BUCKETS = ['apk-drafts', 'apks', 'app-assets'] as const;

export type SweepBucket = (typeof CLEANUP_BUCKETS)[number];

/** Every bucket a managed cleanup target may name. */
export const MANAGED_CLEANUP_BUCKETS = [...CLEANUP_BUCKETS, 'catalog'] as const;

export type CleanupBucket = (typeof MANAGED_CLEANUP_BUCKETS)[number];

export type CleanupTargetType =
  | 'apk_draft'
  | 'apk'
  | 'icon'
  | 'screenshot'
  | 'catalog_document';

/**
 * `assetId` is the identity of the stored object itself, derived from the
 * canonical Storage path. It is never supplied by the browser: a request id
 * identifies the user's operation, not the file.
 *
 * `releaseId` and `catalogFile` are only set for `catalog_document`; the
 * catalog identity is `<releaseId>/<catalogFile>` and the worker uses the
 * release id for its independent retention check.
 */
export type ManagedTarget = Readonly<{
  bucket: CleanupBucket;
  path: string;
  targetType: CleanupTargetType;
  assetId: string;
  /** Catalog only: release id parsed from the canonical path. */
  releaseId: string | null;
  /** Catalog only: which immutable document this job targets. */
  catalogFile: 'apps' | 'categories' | null;
}>;

// Kept in sync with the CHECK constraint on admin_asset_cleanup_jobs. The
// worker reloads paths from the database, so it must reject anything the
// constraint would reject instead of trusting the row.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGE_EXTENSION = '(png|jpg|webp)';
const RELEASE_ID = '[A-Za-z0-9_-]{8,64}';

export const CLEANUP_PATH_PATTERNS: Readonly<Record<CleanupTargetType, string>> = {
  apk_draft: `^operations/(${UUID})/source\\.apk$`,
  apk: `^apps/(${UUID})/versions/(${UUID})\\.apk$`,
  icon: `^apps/(${UUID})/icons/(${UUID})\\.${IMAGE_EXTENSION}$`,
  screenshot: `^apps/(${UUID})/screenshots/(${UUID})\\.${IMAGE_EXTENSION}$`,
  catalog_document: `^releases/(${RELEASE_ID})/(apps|categories)\\.json$`,
};

const draftPathPattern = new RegExp(`^operations/(${UUID})/source\\.apk$`);
const catalogPathPattern = new RegExp(CLEANUP_PATH_PATTERNS.catalog_document);

function bucketForTarget(targetType: CleanupTargetType): CleanupBucket {
  switch (targetType) {
    case 'apk_draft':
      return 'apk-drafts';
    case 'apk':
      return 'apks';
    case 'icon':
    case 'screenshot':
      return 'app-assets';
    case 'catalog_document':
      return 'catalog';
  }
}

function isKnownTargetType(value: string): value is CleanupTargetType {
  return (
    value === 'apk_draft' ||
    value === 'apk' ||
    value === 'icon' ||
    value === 'screenshot' ||
    value === 'catalog_document'
  );
}

export function assetIdFromDraftPath(path: string): string | null {
  const match = draftPathPattern.exec(path);
  return match ? match[1] : null;
}

/**
 * Validates bucket, target type and canonical path together and derives the
 * asset id from the path. A queue row is only actionable when all three agree:
 * the bucket alone does not say which regex applies, and the regex alone does
 * not say which bucket the object lives in.
 *
 * The SQL queue and audit rows still name this value `operation_id`; that
 * column name predates the identity split. The TypeScript identity is always
 * the path-derived asset id.
 */
export function managedTarget(
  bucket: string,
  path: string,
  targetType: string,
): ManagedTarget | null {
  if (!isKnownTargetType(targetType)) return null;
  if (bucket !== bucketForTarget(targetType)) return null;

  if (targetType === 'catalog_document') {
    const match = catalogPathPattern.exec(path);
    if (!match) return null;

    const releaseId = match[1];
    const catalogFile = match[2] as 'apps' | 'categories';
    if (!releaseId) return null;

    return {
      bucket: 'catalog',
      path,
      targetType,
      assetId: `${releaseId}/${catalogFile}`,
      releaseId,
      catalogFile,
    };
  }

  const match = new RegExp(CLEANUP_PATH_PATTERNS[targetType]).exec(path);
  if (!match) return null;

  const assetId = targetType === 'apk_draft' ? match[1] : match[2];
  if (!assetId) return null;

  return {
    bucket: bucketForTarget(targetType),
    path,
    targetType,
    assetId,
    releaseId: null,
    catalogFile: null,
  };
}
