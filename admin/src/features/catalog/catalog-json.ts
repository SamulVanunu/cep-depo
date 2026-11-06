import { createHash } from 'node:crypto';

import type { ActionError, ActionErrorCode } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import type { AdminIdentity } from '../../server/auth/require-admin';
import { isCatalogJsonServerEnabled } from '../../lib/catalog-json-flag';
import { canonicalJson, computePayloadDigest, sha256Hex } from './payload-digest';

export const CATALOG_BUCKET = 'catalog' as const;
export const CATALOG_SCHEMA_VERSION = 2 as const;

export type CatalogJsonFileName = 'manifest.json' | 'apps.json' | 'categories.json';

export type CatalogCardRow =
  import('../../types/database.types').Database['public']['Views']['catalog_app_cards']['Row'];

export type CatalogCategoryRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  position: number;
}>;

export type CatalogJsonManifest = Readonly<{
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  appCount: number;
  categoryCount: number;
  files: Readonly<{ apps: 'apps.json'; categories: 'categories.json' }>;
}>;

export type CatalogJsonApps = Readonly<{
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  apps: readonly CatalogCardRow[];
}>;

export type CatalogJsonCategories = Readonly<{
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  categories: readonly CatalogCategoryRow[];
}>;

export type CatalogJsonDocuments = Readonly<{
  manifest: CatalogJsonManifest;
  apps: CatalogJsonApps;
  categories: CatalogJsonCategories;
}>;

export type CatalogJsonUpload = Readonly<{
  file: CatalogJsonFileName;
  body: string;
}>;

/** Lease returned by `acquire_catalog_publish_lease`. */
export type CatalogPublishLease = Readonly<{
  leaseToken: string;
  leaseExpiresAt: string;
  stateGeneration: number;
}>;

export type CatalogLeaseAcquireInput = Readonly<{
  operationId: string;
  leaseSeconds: number;
  /**
   * A10.36 S5 made the lease attempt-aware. The producer always presents the
   * attempt it will seal with, so a lease can never be driven by a second
   * attempt of the same operation.
   */
  attemptId: string;
}>;

export type CatalogLeaseRenewInput = Readonly<{
  operationId: string;
  leaseToken: string;
  leaseSeconds: number;
  attemptId: string;
}>;

export type CatalogLeaseAssertInput = Readonly<{
  operationId: string;
  leaseToken: string;
  attemptId: string;
}>;

export type CatalogLeaseReleaseInput = Readonly<{
  operationId: string;
  leaseToken: string;
  attemptId: string;
}>;

/** Claim over the mutable root manifest, taken only after a durable commit. */
export type CatalogManifestClaimInput = Readonly<{
  operationId: string;
  attemptId: string;
  actorId: string;
  releaseId: string;
  claimSeconds: number;
}>;

/**
 * The committed history row as returned by `claim_catalog_manifest`. Every
 * value is database-owned: the recovery path rebuilds the manifest from these,
 * never from a caller count or timestamp.
 */
export type CatalogManifestClaim = Readonly<{
  claimToken: string;
  claimExpiresAt: string;
  generation: number;
  releaseId: string;
  generatedAt: string;
  appCount: number;
  categoryCount: number;
  idempotent: boolean;
}>;

/** Identity that assert and release prove against the held claim. */
export type CatalogManifestClaimToken = Readonly<{
  operationId: string;
  claimToken: string;
  attemptId: string;
  actorId: string;
}>;

export type CatalogBeginIntentInput = Readonly<{
  operationId: string;
  releaseId: string;
  expectedGeneration: number;
}>;

/**
 * The database's recorded intent. `status` is kept as a string because it is
 * a database-owned lifecycle value; the producer compares it against the
 * states it knows rather than casting it into a closed union.
 */
export type CatalogPublishIntent = Readonly<{
  operationId: string;
  releaseId: string;
  status: string;
  expectedGeneration: number;
  payloadDigest: string | null;
  attemptId: string | null;
  sealedAt: string | null;
  idempotent: boolean;
  /** Present on a terminal failed intent; absent from `begin`'s response. */
  failureCode?: string | null;
  failureReason?: string | null;
}>;

/** Identity a committed result read is bound to. */
export type CatalogPublishResultInput = Readonly<{
  operationId: string;
  attemptId: string;
  actorId: string;
  /**
   * The caller's release id when it knows one. `null` adopts the history's
   * release, which is what a fresh HTTP retry has to do: the commit dropped the
   * payload, so a retry cannot reconstruct the release id from it.
   */
  releaseId: string | null;
}>;

/**
 * The durable result of a committed operation, read from
 * `catalog_publish_history`. Every value is database-owned; nothing here is
 * supplied by the caller.
 */
export type CatalogPublishResult = Readonly<{
  operationId: string;
  releaseId: string;
  generation: number;
  committedAt: string;
  generatedAt: string;
  appCount: number;
  categoryCount: number;
  actorId: string;
  isCurrent: boolean;
  currentGeneration: number;
}>;

export type CatalogSealIntentInput = Readonly<{
  operationId: string;
  attemptId: string;
  payload: string;
  payloadDigest: string;
}>;

export type CatalogPublishSeal = Readonly<{
  operationId: string;
  status: string;
  payloadDigest: string;
  attemptId: string;
  sealedAt: string | null;
  idempotent: boolean;
}>;

export type CatalogPublishSealedPayload = Readonly<{
  payload: string;
  payloadDigest: string;
}>;

/**
 * The slice of `catalog_publish_state` the producer needs before an intent
 * exists: the generation the intent must be based on, and (on a retry after a
 * seal) the lease that attempt already holds.
 */
export type CatalogPublishStateRow = Readonly<{
  generation: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  leaseOperationId: string | null;
  leaseAttemptId: string | null;
}>;

/**
 * The sealed payload is a canonical JSON object whose members are the exact
 * file texts. Keeping the texts as strings means a retry can re-upload the
 * stored bytes without parsing and re-serializing a document.
 */
export type CatalogPublishPayloadText = Readonly<{
  apps: string;
  categories: string;
  manifest: string;
}>;

export type CatalogPublishBuiltPayload = Readonly<{
  files: CatalogPublishPayloadText;
  text: string;
  digest: string;
}>;

/**
 * The exact values `commit_catalog_publish` receives. Every field except the
 * lease/actor/attempt triple is copied from the published manifest; nothing is
 * recomputed between the upload and the commit.
 */
export type CatalogPublishCommitInput = Readonly<{
  operationId: string;
  leaseToken: string;
  attemptId: string;
  actorId: string;
  expectedGeneration: number;
  releaseId: string;
  generatedAt: string;
  appCount: number;
  categoryCount: number;
}>;

export type CatalogPublishCommitOutcome = 'committed' | 'failed';

/** Result of `commit_catalog_publish`. */
export type CatalogPublishCommitResult = Readonly<{
  releaseId: string | null;
  generation: number | null;
  committedAt: string | null;
  idempotent: boolean;
  outcome: CatalogPublishCommitOutcome;
  failureCode: string | null;
}>;

/**
 * The bucket enforces a 2 MiB per-object limit; stay comfortably below it so
 * oversized catalogs fail before touching Storage instead of at upload time.
 */
export const CATALOG_JSON_BYTE_LIMIT = 1_572_864 as const; // 1.5 MiB

/**
 * The sealed payload is one object holding the three file texts, so its size
 * is bounded by the seal RPC's own 5 MiB limit. It is checked locally first so
 * an oversized catalog fails with the producer's existing internal-error
 * contract instead of a database validation error.
 */
export const CATALOG_PUBLISH_PAYLOAD_BYTE_LIMIT = 5_242_880 as const; // 5 MiB

/** Same shape the intent, commit and consumer all validate. */
export const CATALOG_RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Supabase Storage SDK 2.117.2 exposes `cacheControl` as a seconds string and
 * sends it verbatim as `Cache-Control: max-age=<value>` — it has no directive
 * support, so `immutable`/`public` cannot be added here. Release objects live
 * under an immutable `releases/{id}/` path, so they are safe to cache for a
 * year. The manifest pointer is mutable and must stay short-lived; a short TTL
 * limits staleness but does NOT guarantee immediate CDN invalidation, because
 * the installed SDK has no upload-time purge.
 */
export const CATALOG_JSON_RELEASE_CACHE_CONTROL = '31536000' as const; // 1 year
export const CATALOG_JSON_MANIFEST_CACHE_CONTROL = '60' as const; // 1 minute

/**
 * Publish-lease lifetime. The database accepts 30..900 seconds; acquire and
 * renew must use the same value so a renewal never shortens the lease the run
 * is relying on. 120s covers the catalog read plus two or three small uploads
 * with room to spare, while a crashed process only blocks publication for two
 * minutes.
 */
export const CATALOG_PUBLISH_LEASE_SECONDS = 120 as const;

/**
 * Manifest-claim lifetime. The claim covers one small upload, so it is much
 * shorter than the publish lease; the database still accepts 30..900 seconds.
 * An expired claim is safe to take over, and assert fails closed before the
 * upload if the claim ran out.
 */
export const CATALOG_MANIFEST_CLAIM_SECONDS = 60 as const;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Code-unit comparison, never locale-aware: `localeCompare` depends on the
 * runtime locale and would make the published byte order environment-specific.
 */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function orderCards(cards: readonly CatalogCardRow[]): CatalogCardRow[] {
  // `app_id` is nullable in the generated view type even though the view
  // derives it from `apps.id`; an absent id sorts first and stays stable.
  return [...cards].sort((left, right) =>
    compareText(left.app_id ?? '', right.app_id ?? ''),
  );
}

function orderCategories(
  categories: readonly CatalogCategoryRow[],
): CatalogCategoryRow[] {
  return [...categories].sort(
    (left, right) =>
      left.position - right.position || compareText(left.id, right.id),
  );
}

/**
 * A10.36 S1 — the published bytes must be a pure function of the catalog
 * contents, never of the row order the database happened to return. Sorting
 * here keeps the invariant local even if a caller forgets to order its query;
 * the queries ask for the same order explicitly as the primary defence.
 */
export function buildCatalogDocuments(
  cards: readonly CatalogCardRow[],
  categories: readonly CatalogCategoryRow[],
  generatedAt: string,
): CatalogJsonDocuments {
  const apps: CatalogJsonApps = Object.freeze({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt,
    apps: Object.freeze(orderCards(cards)),
  });
  const categoryDocument: CatalogJsonCategories = Object.freeze({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt,
    categories: Object.freeze(orderCategories(categories)),
  });
  const manifest: CatalogJsonManifest = Object.freeze({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt,
    appCount: cards.length,
    categoryCount: categories.length,
    files: Object.freeze({ apps: 'apps.json', categories: 'categories.json' }),
  });
  return Object.freeze({ manifest, apps, categories: categoryDocument });
}

/**
 * Upload order matters: clients read the manifest last, so it must only ever
 * reference data files that are already written for the same run.
 */
export function catalogUploadPlan(documents: CatalogJsonDocuments): readonly CatalogJsonUpload[] {
  return Object.freeze([
    { file: 'apps.json', body: JSON.stringify(documents.apps) },
    { file: 'categories.json', body: JSON.stringify(documents.categories) },
    { file: 'manifest.json', body: JSON.stringify(documents.manifest) },
  ]);
}

/**
 * A10.36 S7 — the attempt id must survive an HTTP retry without a persistence
 * round-trip. The intent row does not exist before `begin` and cannot carry an
 * attempt before `seal`, but `acquire_catalog_publish_lease` needs one first.
 * Deriving it from the operation id (the identity that is already stable for
 * the whole publication) makes every retry of that operation present the same
 * attempt, and gives a different operation a different attempt.
 *
 * This is deliberately not a random id: a random attempt would make a retry
 * look like a takeover to the S5 lease checks.
 */
export function derivePublishAttemptId(operationId: string): string {
  const digest = createHash('sha256')
    .update(`catalog-publish-attempt:${operationId}`, 'utf8')
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  // RFC 4122 shape: version 5 (name-based) and the RFC variant. The database
  // only requires a UUID; the shape keeps the value recognizable in operator
  // output and usable by any UUID tooling.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Builds the one payload the intent seals. The manifest is finalized with the
 * release id and release paths first, so the sealed bytes are exactly the
 * bytes the consumer will read. The digest is over the canonical JSON of the
 * three texts, never over an implicit string conversion.
 */
export function buildCatalogPublishPayload(
  documents: CatalogJsonDocuments,
  releaseId: string,
): CatalogPublishBuiltPayload {
  const files: CatalogPublishPayloadText = Object.freeze({
    apps: JSON.stringify(documents.apps),
    categories: JSON.stringify(documents.categories),
    manifest: manifestWithRelease(JSON.stringify(documents.manifest), releaseId),
  });
  const text = canonicalJson(files);
  return Object.freeze({
    files,
    text,
    digest: computePayloadDigest(files),
  });
}

/**
 * Reads the sealed bundle back. The members are returned exactly as stored;
 * nothing here re-serializes a document. A malformed bundle is a corrupt
 * record, not a payload to guess at, so it is refused.
 */
function parseCatalogPublishPayload(text: string): CatalogPublishPayloadText {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ActionException('INTERNAL');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ActionException('INTERNAL');
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  const members = ['apps', 'categories', 'manifest'] as const;
  if (members.some(member => typeof record[member] !== 'string')) {
    throw new ActionException('INTERNAL');
  }
  return Object.freeze({
    apps: record.apps as string,
    categories: record.categories as string,
    manifest: record.manifest as string,
  });
}

type CatalogManifestCommitValues = Readonly<{
  generatedAt: string;
  appCount: number;
  categoryCount: number;
}>;

/**
 * Commit values come from the sealed manifest, never from a second
 * computation. The release id is re-checked so a stored payload for a
 * different release can never be committed under this one.
 */
function manifestCommitValues(
  manifestText: string,
  releaseId: string,
): CatalogManifestCommitValues {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    throw new ActionException('INTERNAL');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ActionException('INTERNAL');
  }
  const manifest = parsed as Readonly<Record<string, unknown>>;
  if (
    manifest.releaseId !== releaseId ||
    typeof manifest.generatedAt !== 'string' ||
    typeof manifest.appCount !== 'number' ||
    !Number.isInteger(manifest.appCount) ||
    manifest.appCount < 0 ||
    typeof manifest.categoryCount !== 'number' ||
    !Number.isInteger(manifest.categoryCount) ||
    manifest.categoryCount < 0
  ) {
    throw new ActionException('INTERNAL');
  }
  return Object.freeze({
    generatedAt: manifest.generatedAt,
    appCount: manifest.appCount,
    categoryCount: manifest.categoryCount,
  });
}

export type CatalogRefreshDependencies = Readonly<{
  loadCards(): Promise<{
    data: readonly CatalogCardRow[] | null;
    error: unknown | null;
  }>;
  loadCategories(): Promise<{
    data: readonly CatalogCategoryRow[] | null;
    error: unknown | null;
  }>;
  /** Writes one object; release-scoped data files use the third argument. */
  upload(
    file: CatalogJsonFileName,
    body: string,
    releaseId: string,
  ): Promise<{ error: unknown | null }>;
  createGeneratedAt(): string;
  /**
   * Ids are minted inside the queued run, after the queue admits this
   * publication: a run that waited must not publish ids created before it.
   * An HTTP retry supplies the same ids through these two factories.
   */
  createOperationId(): string;
  createReleaseId(): string;
  /** Authorized admin committing the publication. */
  actorId: string;
  /**
   * The state row read before `begin`: the intent must be based on the live
   * generation, and a sealed retry adopts the lease this attempt already holds
   * because `acquire` refuses a sealed intent by design.
   */
  loadPublishState(): Promise<{
    data: CatalogPublishStateRow | null;
    error: unknown | null;
  }>;
  /**
   * Reads the operation's intent before any decision. `null` means the
   * operation has not started yet; a row means a retry must adopt its release,
   * generation and status instead of minting new ids or calling `begin`.
   */
  getIntent(operationId: string): Promise<{
    data: CatalogPublishIntent | null;
    error: unknown | null;
  }>;
  /**
   * The release id the caller supplied for this operation, if any. A new
   * operation may carry one; a retry adopts the stored intent's value and a
   * mismatch is refused rather than silently rebased.
   */
  requestedReleaseId: string | null;
  beginIntent(input: CatalogBeginIntentInput): Promise<{
    data: CatalogPublishIntent | null;
    error: unknown | null;
  }>;
  sealIntent(input: CatalogSealIntentInput): Promise<{
    data: CatalogPublishSeal | null;
    error: unknown | null;
  }>;
  /** Returns the exact stored text; only called on a sealed retry. */
  loadSealedPayload(input: {
    operationId: string;
    attemptId: string;
  }): Promise<{
    data: CatalogPublishSealedPayload | null;
    error: unknown | null;
  }>;
  acquireLease(input: CatalogLeaseAcquireInput): Promise<{
    data: CatalogPublishLease | null;
    error: unknown | null;
  }>;
  assertLease(input: CatalogLeaseAssertInput): Promise<{
    data: boolean | null;
    error: unknown | null;
  }>;
  renewLease(input: CatalogLeaseRenewInput): Promise<{ error: unknown | null }>;
  releaseLease(input: CatalogLeaseReleaseInput): Promise<{ error: unknown | null }>;
  /** Claims the mutable manifest for one committed generation. */
  claimManifest(input: CatalogManifestClaimInput): Promise<{
    data: CatalogManifestClaim | null;
    error: unknown | null;
  }>;
  /** Re-proves the claim immediately before the manifest upload. */
  assertManifestClaim(input: CatalogManifestClaimToken): Promise<{
    data: boolean | null;
    error: unknown | null;
  }>;
  releaseManifestClaim(input: CatalogManifestClaimToken): Promise<{
    error: unknown | null;
  }>;
  /** Root `manifest.json`; a missing object is `null`, not an error. */
  downloadManifest(): Promise<{
    data: string | null;
    error: unknown | null;
  }>;
  commit(input: CatalogPublishCommitInput): Promise<{
    data: CatalogPublishCommitResult | null;
    error: unknown | null;
  }>;
  /** Reads the durable result of a committed operation; committed-only. */
  getResult(input: CatalogPublishResultInput): Promise<{
    data: CatalogPublishResult | null;
    error: unknown | null;
  }>;
}>;

export type CatalogRefreshResult = Readonly<{ error: ActionError | null }>;

/**
 * Serializes catalog refreshes inside this server process so two concurrent
 * admin actions cannot interleave their uploads. Supabase Storage offers no
 * atomic multi-object commit, so cross-process races are limited (not
 * eliminated) by always uploading the manifest last; see the stage report.
 */
let refreshQueue: Promise<unknown> = Promise.resolve();

function enqueueCatalogRefresh(task: () => Promise<CatalogRefreshResult>): Promise<CatalogRefreshResult> {
  const result = refreshQueue.then(task, task);
  refreshQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Finalizes the manifest payload so the pointer names the immutable release
 * uploaded by this run: the `releaseId` plus the two `releases/{id}/*` paths
 * the mobile consumer resolves. Runs BEFORE the byte-limit check, therefore
 * the limit is always enforced against the exact bytes sent to Storage. Data
 * documents keep their logical file names in the upload plan; only the written
 * object keys are release-scoped (mapped in the action's upload closure).
 */
function manifestWithRelease(body: string, releaseId: string): string {
  const document = JSON.parse(body) as Readonly<Record<string, unknown>>;
  return JSON.stringify({
    ...document,
    releaseId,
    files: {
      apps: `releases/${releaseId}/apps.json`,
      categories: `releases/${releaseId}/categories.json`,
    },
  });
}

/**
 * PostgreSQL renders a timestamptz as `+00:00`, while the producer writes
 * `Date#toISOString()` (`Z`, milliseconds). The manifest is compared
 * semantically, but the recovery rebuild must still produce the same bytes as
 * the first publish, so the database spelling is normalized exactly once.
 */
function normalizeGeneratedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ActionException('INTERNAL');
  }
  return parsed.toISOString();
}

/**
 * S8 — the recovery path has no sealed manifest: the commit dropped the
 * payload. The claim returns the committed history values, and this function
 * rebuilds the exact document `manifestWithRelease` produced at publish time,
 * including key order.
 */
function manifestFromClaim(claim: CatalogManifestClaim): string {
  return JSON.stringify({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: normalizeGeneratedAt(claim.generatedAt),
    appCount: claim.appCount,
    categoryCount: claim.categoryCount,
    files: {
      apps: `releases/${claim.releaseId}/apps.json`,
      categories: `releases/${claim.releaseId}/categories.json`,
    },
    releaseId: claim.releaseId,
  });
}

/**
 * Compares documents, not bytes: a manifest that is already correct is not
 * re-uploaded just because its whitespace or key order differs. An unreadable
 * stored manifest is treated as wrong so the repair replaces it.
 */
function manifestsSemanticallyEqual(existingText: string, desiredText: string): boolean {
  let existing: unknown;
  let desired: unknown;
  try {
    existing = JSON.parse(existingText);
    desired = JSON.parse(desiredText);
  } catch {
    return false;
  }
  return canonicalJson(existing) === canonicalJson(desired);
}

/**
 * Narrow, local SQLSTATE mapping for the publish RPCs. Kept here (not in the
 * shared error table) so A10.34f can own the global version without this
 * feature reaching into unrelated actions.
 */
const catalogPublishSqlStateCodes: Readonly<Record<string, ActionErrorCode>> = Object.freeze({
  CDP01: 'TEMPORARY',
  CDP02: 'CONFLICT',
  CDP03: 'CONFLICT',
  CDP04: 'TEMPORARY',
  CDP05: 'CONFLICT',
  CDP06: 'CONFLICT',
  CDP07: 'CONFLICT',
  CDP08: 'CONFLICT',
  CDP09: 'CONFLICT',
  CDP10: 'CONFLICT',
  CDI01: 'CONFLICT',
  CDI02: 'CONFLICT',
  CDI03: 'CONFLICT',
  CDI04: 'TEMPORARY',
  '55P03': 'TEMPORARY',
  '22004': 'VALIDATION',
  '22023': 'VALIDATION',
  // Not expected from these RPCs; it must never surface as user validation.
  P0001: 'FORBIDDEN',
});

/** Reads the SQLSTATE from a PostgREST error without inspecting the message. */
function sqlStateOf(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as Readonly<{ code?: unknown }>).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

function sqlStateActionCode(error: unknown): ActionErrorCode | null {
  const code = sqlStateOf(error);
  return code === null ? null : catalogPublishSqlStateCodes[code] ?? null;
}

/**
 * A commit is ambiguous only when the RPC cannot say whether the transaction
 * committed: a transport failure (no SQLSTATE, no HTTP status) or a 5xx
 * response. A SQLSTATE always wins over an HTTP status.
 */
function isAmbiguousCommitFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  const candidate = error as Readonly<{ code?: unknown; status?: unknown }>;
  if (typeof candidate.code === 'string' && candidate.code.length > 0) return false;
  if (typeof candidate.status === 'number') return candidate.status >= 500;
  return true;
}

function publishErrorCode(error: unknown, fallback: ActionErrorCode): ActionErrorCode {
  return sqlStateActionCode(error) ?? fallback;
}

function commitErrorCode(error: unknown): ActionErrorCode {
  return sqlStateActionCode(error) ?? (isAmbiguousCommitFailure(error) ? 'TEMPORARY' : 'INTERNAL');
}

/**
 * Best-effort cleanup after a failed publication. A failed release must never
 * mask or replace the failure the admin already holds; the lease expires on
 * its own even if this call is lost.
 */
async function releaseQuietly(
  dependencies: CatalogRefreshDependencies,
  lease: CatalogLeaseReleaseInput,
): Promise<void> {
  try {
    await dependencies.releaseLease(lease);
  } catch {
    // Intentionally swallowed.
  }
}

/** Best-effort claim cleanup; the caller decides whether to surface failure. */
async function releaseManifestClaimQuietly(
  dependencies: CatalogRefreshDependencies,
  claim: CatalogManifestClaimToken,
): Promise<{ error: unknown | null }> {
  try {
    return await dependencies.releaseManifestClaim(claim);
  } catch (error) {
    return { error };
  }
}

/**
 * S8 — the single manifest fence used by both the normal publish and committed
 * recovery.
 *
 * Claim, read the current pointer, skip a correct manifest, assert the claim
 * immediately before the upload, upload, release. `CDP06` at claim or assert
 * means a newer commit now owns the manifest: the publish is still durable and
 * superseded, so this is a successful stop rather than an error. Any other
 * failure leaves the upload undone and is reported; because the commit is
 * durable, a retry with the same operation id re-enters this function and
 * completes the manifest.
 */
async function finalizeManifest(
  dependencies: CatalogRefreshDependencies,
  input: Readonly<{
    operationId: string;
    attemptId: string;
    releaseId: string;
    /** The sealed manifest on a fresh publish; `null` on recovery. */
    manifestText: string | null;
  }>,
): Promise<void> {
  const claimed = await dependencies.claimManifest({
    operationId: input.operationId,
    attemptId: input.attemptId,
    actorId: dependencies.actorId,
    releaseId: input.releaseId,
    claimSeconds: CATALOG_MANIFEST_CLAIM_SECONDS,
  });
  if (claimed.error || !claimed.data) {
    if (sqlStateOf(claimed.error) === 'CDP06') return;
    throw new ActionException(publishErrorCode(claimed.error, 'TEMPORARY'));
  }

  const claim = claimed.data;
  if (
    claim.claimToken.length === 0 ||
    claim.releaseId !== input.releaseId ||
    !Number.isSafeInteger(claim.generation) ||
    claim.generation < 0
  ) {
    throw new ActionException('INTERNAL');
  }

  let manifestText: string;
  if (input.manifestText === null) {
    manifestText = manifestFromClaim(claim);
  } else {
    // The sealed manifest and the committed history must describe the same
    // release. A mismatch means the bytes and the ledger disagree; never write.
    const sealed = manifestCommitValues(input.manifestText, claim.releaseId);
    if (
      normalizeGeneratedAt(sealed.generatedAt) !== normalizeGeneratedAt(claim.generatedAt) ||
      sealed.appCount !== claim.appCount ||
      sealed.categoryCount !== claim.categoryCount
    ) {
      throw new ActionException('INTERNAL');
    }
    manifestText = input.manifestText;
  }

  const token: CatalogManifestClaimToken = Object.freeze({
    operationId: input.operationId,
    claimToken: claim.claimToken,
    attemptId: input.attemptId,
    actorId: dependencies.actorId,
  });

  let failure: unknown = null;
  let superseded = false;
  try {
    const current = await dependencies.downloadManifest();
    if (current.error) {
      throw new ActionException(publishErrorCode(current.error, 'TEMPORARY'));
    }

    if (current.data !== null && manifestsSemanticallyEqual(current.data, manifestText)) {
      // Already correct: the pointer is not rewritten just to change bytes.
    } else {
      const asserted = await dependencies.assertManifestClaim(token);
      if (asserted.error || asserted.data !== true) {
        if (sqlStateOf(asserted.error) === 'CDP06') {
          superseded = true;
        } else {
          throw new ActionException(publishErrorCode(asserted.error, 'CONFLICT'));
        }
      } else {
        const uploaded = await dependencies.upload(
          'manifest.json',
          manifestText,
          claim.releaseId,
        );
        if (uploaded.error) {
          throw new ActionException(publishErrorCode(uploaded.error, 'TEMPORARY'));
        }
      }
    }
  } catch (error) {
    failure = error;
  }

  const released = await releaseManifestClaimQuietly(dependencies, token);
  if (failure) throw failure;
  if (!superseded && released.error) {
    // The manifest itself is correct; the claim will expire on its own and a
    // retry finds the manifest already current and skips the upload. This is
    // a temporary cleanup failure, never the publication's outcome.
    throw new ActionException('TEMPORARY');
  }
}

export async function refreshCatalogJsonFiles(
  dependencies: CatalogRefreshDependencies,
): Promise<CatalogRefreshResult> {
  return enqueueCatalogRefresh(async () => {
    let lease: CatalogLeaseReleaseInput | null = null;
    try {
      // 1. Publication identity is decided once, before the first RPC, and is
      // passed in by the caller on an HTTP retry. The same operation id always
      // derives the same attempt, so the retry presents the identity the first
      // run sealed with instead of looking like a takeover.
      const operationId = dependencies.createOperationId();
      if (typeof operationId !== 'string' || !UUID_PATTERN.test(operationId)) {
        throw new ActionException('INTERNAL');
      }
      const attemptId = derivePublishAttemptId(operationId);

      // 2. Pre-read the intent. This is what makes recovery possible: a commit
      // advances the state generation past the intent's base, so `begin` on a
      // retry would raise CDP08 before the producer ever saw `committed`. A
      // row here means the operation already exists and its release and
      // generation must be adopted verbatim; `begin` is only for a new one.
      const preRead = await dependencies.getIntent(operationId);
      if (preRead.error) {
        throw new ActionException(publishErrorCode(preRead.error, 'TEMPORARY'));
      }

      let intent: CatalogPublishIntent;
      let releaseId: string;

      if (preRead.data) {
        if (
          dependencies.requestedReleaseId !== null &&
          dependencies.requestedReleaseId !== preRead.data.releaseId
        ) {
          // The caller is retrying with a release this operation never used.
          throw new ActionException('CONFLICT');
        }
        releaseId = preRead.data.releaseId;
        intent = preRead.data;
      } else {
        releaseId = dependencies.createReleaseId();
        if (
          typeof releaseId !== 'string' ||
          !CATALOG_RELEASE_ID_PATTERN.test(releaseId)
        ) {
          throw new ActionException('INTERNAL');
        }

        // The generation the intent must be based on. It has to be read before
        // `begin`, because `begin` takes it as a parameter and the intent does
        // not exist yet.
        const state = await dependencies.loadPublishState();
        if (state.error || !state.data) {
          throw new ActionException(publishErrorCode(state.error, 'TEMPORARY'));
        }

        // 3. Begin (idempotent on the operation/release/generation triple).
        const begun = await dependencies.beginIntent({
          operationId,
          releaseId,
          expectedGeneration: state.data.generation,
        });

        if (begun.error && sqlStateOf(begun.error) === 'CDP08') {
          // Two first requests can both miss the pre-read. The loser's begin
          // reports that the operation already exists; re-read once and adopt
          // the winner's release and generation. No second begin, no new ids.
          const reread = await dependencies.getIntent(operationId);
          if (reread.error || !reread.data) {
            throw new ActionException(publishErrorCode(begun.error, 'CONFLICT'));
          }
          if (
            dependencies.requestedReleaseId !== null &&
            dependencies.requestedReleaseId !== reread.data.releaseId
          ) {
            throw new ActionException('CONFLICT');
          }
          releaseId = reread.data.releaseId;
          intent = reread.data;
        } else {
          if (begun.error || !begun.data) {
            throw new ActionException(publishErrorCode(begun.error, 'TEMPORARY'));
          }
          intent = begun.data;
        }
      }

      if (
        intent.operationId !== operationId ||
        intent.releaseId !== releaseId
      ) {
        throw new ActionException('CONFLICT');
      }

      const isRetry = intent.status === 'sealed';
      let leaseToken: string;
      let expectedGeneration: number;

      if (intent.status === 'committed') {
        // 4. The commit is durable; only its HTTP response was lost. The
        // history row is the authoritative result and the pointer decides
        // whether a newer publication has since passed this one. A superseded
        // commit is still a success and writes nothing. A current one rebuilds
        // the manifest from history and completes it through the same fence as
        // a fresh publish.
        const readResult = await dependencies.getResult({
          operationId,
          attemptId,
          actorId: dependencies.actorId,
          releaseId: dependencies.requestedReleaseId,
        });
        if (readResult.error || !readResult.data) {
          throw new ActionException(publishErrorCode(readResult.error, 'CONFLICT'));
        }
        if (readResult.data.operationId !== operationId) {
          throw new ActionException('CONFLICT');
        }
        if (!readResult.data.isCurrent) {
          return { error: null };
        }
        await finalizeManifest(dependencies, {
          operationId,
          attemptId,
          releaseId: readResult.data.releaseId,
          manifestText: null,
        });
        return { error: null };
      }

      if (intent.status === 'failed') {
        // A terminal failure is already recorded. Replaying this operation can
        // never succeed; the user has to start a new publish (and therefore a
        // new operation id). The recorded failure code stays on the row, but
        // the HTTP outcome is a conflict, not a validation or a retry.
        throw new ActionException('CONFLICT');
      }

      if (intent.status === 'in_progress') {
        // 5. The lease is the cross-process coordination point. It is taken
        // before the catalog read and before any Storage write, and the token
        // and expected generation come from its response, never a guess.
        const acquired = await dependencies.acquireLease({
          operationId,
          leaseSeconds: CATALOG_PUBLISH_LEASE_SECONDS,
          attemptId,
        });
        if (acquired.error || !acquired.data) {
          throw new ActionException(publishErrorCode(acquired.error, 'TEMPORARY'));
        }
        leaseToken = acquired.data.leaseToken;
        expectedGeneration = acquired.data.stateGeneration;
        lease = Object.freeze({ operationId, leaseToken, attemptId });
      } else if (isRetry) {
        // A retry after a seal cannot acquire again: S5 allows an attempt to
        // acquire only an in_progress intent, so the token from the first run
        // is read from the state row and every later call still proves the
        // attempt. A lease that is gone or belongs to someone else is lease
        // loss, not a reason to re-acquire.
        const state = await dependencies.loadPublishState();
        if (state.error || !state.data) {
          throw new ActionException(publishErrorCode(state.error, 'TEMPORARY'));
        }
        if (intent.attemptId !== attemptId) {
          throw new ActionException('CONFLICT');
        }
        if (intent.expectedGeneration !== state.data.generation) {
          // Another operation advanced the generation: this intent is stale
          // and must never be rebased onto the new world.
          throw new ActionException('CONFLICT');
        }
        if (
          state.data.leaseToken === null ||
          state.data.leaseOperationId !== operationId ||
          state.data.leaseAttemptId !== attemptId
        ) {
          throw new ActionException('CONFLICT');
        }
        leaseToken = state.data.leaseToken;
        expectedGeneration = intent.expectedGeneration;
        lease = Object.freeze({ operationId, leaseToken, attemptId });
      } else {
        // Unknown status: S3 owns the closed set, so this is a corrupt row, not
        // something to publish.
        throw new ActionException('CONFLICT');
      }

      // 5-8. On the first run the catalog is read under the lease and the
      // payload is built once. On a sealed retry the stored text is used
      // verbatim: no catalog query, no document rebuild, no re-serialization.
      let files: CatalogPublishPayloadText;
      let payloadText: string;
      let payloadDigest: string;

      if (isRetry) {
        const sealed = await dependencies.loadSealedPayload({
          operationId,
          attemptId,
        });
        if (sealed.error || !sealed.data) {
          throw new ActionException(publishErrorCode(sealed.error, 'CONFLICT'));
        }
        payloadText = sealed.data.payload;
        payloadDigest = sealed.data.payloadDigest;
        if (
          intent.payloadDigest !== payloadDigest ||
          // The digest must describe the exact stored bytes. A re-serialized
          // form would hash to the same value only by accident, so the check
          // is over the text itself.
          sha256Hex(new TextEncoder().encode(payloadText)) !== payloadDigest
        ) {
          throw new ActionException('CONFLICT');
        }
        files = parseCatalogPublishPayload(payloadText);
      } else {
        const cards = await dependencies.loadCards();
        if (cards.error || !cards.data) {
          throw new ActionException('TEMPORARY');
        }
        const categories = await dependencies.loadCategories();
        if (categories.error || !categories.data) {
          throw new ActionException('TEMPORARY');
        }

        const documents = buildCatalogDocuments(
          cards.data,
          categories.data,
          dependencies.createGeneratedAt(),
        );
        const built = buildCatalogPublishPayload(documents, releaseId);
        const oversizedFile = (
          [built.files.apps, built.files.categories, built.files.manifest] as const
        ).find(body => utf8ByteLength(body) > CATALOG_JSON_BYTE_LIMIT);
        if (
          oversizedFile !== undefined ||
          utf8ByteLength(built.text) > CATALOG_PUBLISH_PAYLOAD_BYTE_LIMIT
        ) {
          // Keep the previously published files intact: fail before any
          // Storage write.
          throw new ActionException('INTERNAL');
        }
        files = built.files;
        payloadText = built.text;
        payloadDigest = built.digest;
      }

      // The seal is a replay on a retry: the same attempt, digest and bytes
      // return the stored seal, and different bytes are CDP08.
      const sealedIntent = await dependencies.sealIntent({
        operationId,
        attemptId,
        payload: payloadText,
        payloadDigest,
      });
      if (sealedIntent.error || !sealedIntent.data) {
        throw new ActionException(publishErrorCode(sealedIntent.error, 'TEMPORARY'));
      }
      // 9. Prove the seal completed before the first Storage write: the
      // response must name this attempt and this digest, and describe a
      // sealed intent. Anything else is refused without touching Storage.
      if (
        sealedIntent.data.status !== 'sealed' ||
        sealedIntent.data.attemptId !== attemptId ||
        sealedIntent.data.payloadDigest !== payloadDigest
      ) {
        throw new ActionException('INTERNAL');
      }

      // 13. The attempt witnesses the lease immediately before Storage.
      const asserted = await dependencies.assertLease({
        operationId,
        leaseToken,
        attemptId,
      });
      if (asserted.error || asserted.data !== true) {
        throw new ActionException(publishErrorCode(asserted.error, 'CONFLICT'));
      }

      // 12. Immutable release objects only. The mutable manifest is not written
      // until the commit has succeeded.
      const releaseFiles = [
        { file: 'apps.json' as const, body: files.apps },
        { file: 'categories.json' as const, body: files.categories },
      ];
      for (const item of releaseFiles) {
        const uploaded = await dependencies.upload(item.file, item.body, releaseId);
        if (uploaded.error) {
          throw new ActionException(publishErrorCode(uploaded.error, 'TEMPORARY'));
        }
      }

      // 13. Renew with the same attempt so the commit cannot race an expiry.
      const renewed = await dependencies.renewLease({
        operationId,
        leaseToken,
        leaseSeconds: CATALOG_PUBLISH_LEASE_SECONDS,
        attemptId,
      });
      if (renewed.error) {
        throw new ActionException(publishErrorCode(renewed.error, 'TEMPORARY'));
      }

      // 14. Commit exactly what was sealed. Every value comes from the sealed
      // manifest, never from a second computation.
      const manifestValues = manifestCommitValues(files.manifest, releaseId);
      const commitInput: CatalogPublishCommitInput = Object.freeze({
        operationId,
        leaseToken,
        attemptId,
        actorId: dependencies.actorId,
        expectedGeneration,
        releaseId,
        generatedAt: manifestValues.generatedAt,
        appCount: manifestValues.appCount,
        categoryCount: manifestValues.categoryCount,
      });
      let committed = await dependencies.commit(commitInput);
      if (committed.error && isAmbiguousCommitFailure(committed.error)) {
        // One retry, identical parameters: the database replays the same
        // operation id idempotently. SQLSTATE failures are never retried.
        committed = await dependencies.commit(commitInput);
      }
      if (committed.error || !committed.data) {
        throw new ActionException(commitErrorCode(committed.error));
      }

      // 15. A stale commit is a recorded terminal outcome, not a transport
      // error: the database cleared the lease, wrote no pointer and expects
      // the producer to report the failure without retrying.
      if (committed.data.outcome === 'failed') {
        lease = null;
        throw new ActionException(
          commitErrorCode({ code: committed.data.failureCode ?? 'CDP06' }),
        );
      }

      // The commit cleared the lease in its own transaction; releasing it here
      // would be redundant and could touch a lease another run now owns.
      lease = null;

      // 16. S8 — the mutable pointer is written only after the commit
      // succeeded, and only under the manifest claim for this generation. A
      // newer commit makes the claim/assert fail closed, so this publisher can
      // never resurrect an older manifest. Release files already exist under
      // an immutable path, so a failure here leaves a committed release whose
      // pointer was not updated; that is reported, and a retry recovers.
      await finalizeManifest(dependencies, {
        operationId,
        attemptId,
        releaseId,
        manifestText: files.manifest,
      });

      return { error: null };
    } catch (error) {
      if (lease) await releaseQuietly(dependencies, lease);
      return { error: toActionError(error) };
    }
  });
}

type MutationError = Readonly<{ code?: string; message?: string }> | null;

/**
 * The generated database types predate S4-S6 and cannot be regenerated in this
 * checkout (no local schema/generator). Rather than hand-editing generated
 * files with guessed shapes, the new RPC surface is reached through this one
 * narrow adapter: parameter names and result columns are copied from the
 * migration DDL below, and nothing else in the action loses its types.
 */
type CatalogPublishRpc = (
  name: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<{ data: unknown; error: unknown }>;

type CatalogPublishStateLookup = Readonly<{
  select(columns: string): Readonly<{
    eq(column: string, value: number): Readonly<{
      maybeSingle(): Promise<{ data: unknown; error: unknown }>;
    }>;
  }>;
}>;

function rpcRow(data: unknown): Readonly<Record<string, unknown>> | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const row: unknown = data[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return row as Readonly<Record<string, unknown>>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** PostgREST may render an int8 as a JSON number or a decimal string. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * A missing root manifest is the first-ever publish, not a failure: the fence
 * then uploads the document it built. Every other Storage error is reported.
 */
function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Readonly<{
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  }>;
  const message =
    typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  if (
    message.includes('not found') ||
    message.includes('not_found') ||
    message.includes('does not exist')
  ) {
    return true;
  }
  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.statusCode === '404'
  );
}

/**
 * A release object is immutable and keyed by a release id that is published
 * once, so a duplicate at that exact path can only be this run's earlier
 * upload whose response was lost. The manifest is mutable and uses upsert, so
 * a duplicate there is never expected and is left as an error.
 */
function isDuplicateStorageObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Readonly<{
    status?: unknown;
    statusCode?: unknown;
    error?: unknown;
    message?: unknown;
  }>;
  return (
    candidate.status === 409 ||
    candidate.statusCode === 409 ||
    candidate.statusCode === '409' ||
    candidate.error === 'Duplicate' ||
    candidate.message === 'Duplicate'
  );
}

export type CatalogRefreshActionInput = Readonly<{
  /**
   * Stable publication identity, supplied by a caller retrying the same HTTP
   * request. Both values are generated when omitted, so every existing call
   * site keeps its current behaviour.
   */
  operationId?: string;
  releaseId?: string;
}>;

export type CatalogRefreshAction = (
  input?: CatalogRefreshActionInput,
) => Promise<CatalogRefreshResult>;

/**
 * Production wiring: reads the same catalog_app_cards rows the mobile client
 * sees and uploads only to the read-only `catalog` bucket as JSON.
 */
export function createCatalogRefreshAction(
  authorize: () => Promise<AdminIdentity>,
  recordAudit?: (input: Readonly<{
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Readonly<Record<string, string | number | boolean>>;
  }>) => Promise<{ error: MutationError }>,
): CatalogRefreshAction {
  return async function refreshCatalog(input: CatalogRefreshActionInput = {}) {
    // Gate before any side effect: with the flag off the refresh is a clean
    // no-op, so authorization, Storage uploads and the failure audit never run.
    if (!isCatalogJsonServerEnabled()) return { error: null };

    const identity = await authorize();
    const { getAdminClient } = await import('../../server/supabase/admin-client');
    const client = getAdminClient(identity);
    const rpc = (client.rpc as unknown as CatalogPublishRpc).bind(client) as CatalogPublishRpc;

    // One immutable release per publication: data files are written under
    // `releases/{releaseId}/` and never overwritten, so a failed or concurrent
    // run cannot corrupt the release clients are currently reading.
    const result = await refreshCatalogJsonFiles({
      createOperationId: () => input.operationId ?? crypto.randomUUID(),
      createReleaseId: () => input.releaseId ?? crypto.randomUUID(),
      requestedReleaseId: input.releaseId ?? null,
      actorId: identity.userId,
      async loadPublishState() {
        const stateTable = client.from(
          'catalog_publish_state',
        ) as unknown as CatalogPublishStateLookup;
        const { data, error } = await stateTable
          .select(
            'generation, publish_lock_token, publish_lock_expires_at, publish_operation_id, publish_attempt_id',
          )
          .eq('id', 1)
          .maybeSingle();
        if (error) return { data: null, error };
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return { data: null, error: null };
        }
        const row = data as Readonly<Record<string, unknown>>;
        const generation = asNumber(row.generation);
        if (generation === null) return { data: null, error: null };
        return {
          data: {
            generation,
            leaseToken: asString(row.publish_lock_token),
            leaseExpiresAt: asString(row.publish_lock_expires_at),
            leaseOperationId: asString(row.publish_operation_id),
            leaseAttemptId: asString(row.publish_attempt_id),
          },
          error: null,
        };
      },
      async getIntent(operationId) {
        const { data, error } = await rpc('get_catalog_publish_intent', {
          p_operation_id: operationId,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const returnedOperation = asString(row.operation_id);
        const returnedRelease = asString(row.release_id);
        const status = asString(row.status);
        const returnedGeneration = asNumber(row.expected_generation);
        if (
          returnedOperation === null ||
          returnedRelease === null ||
          status === null ||
          returnedGeneration === null
        ) {
          return { data: null, error: null };
        }
        return {
          data: {
            operationId: returnedOperation,
            releaseId: returnedRelease,
            status,
            expectedGeneration: returnedGeneration,
            payloadDigest: asString(row.payload_digest),
            attemptId: asString(row.attempt_id),
            sealedAt: asString(row.sealed_at),
            idempotent: true,
            failureCode: asString(row.failure_code),
            failureReason: asString(row.failure_reason),
          },
          error: null,
        };
      },
      async beginIntent({ operationId, releaseId, expectedGeneration }) {
        const { data, error } = await rpc('begin_catalog_publish_intent', {
          p_operation_id: operationId,
          p_release_id: releaseId,
          p_expected_generation: expectedGeneration,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const returnedOperation = asString(row.operation_id);
        const returnedRelease = asString(row.release_id);
        const status = asString(row.status);
        const returnedGeneration = asNumber(row.expected_generation);
        if (
          returnedOperation === null ||
          returnedRelease === null ||
          status === null ||
          returnedGeneration === null
        ) {
          return { data: null, error: null };
        }
        return {
          data: {
            operationId: returnedOperation,
            releaseId: returnedRelease,
            status,
            expectedGeneration: returnedGeneration,
            payloadDigest: asString(row.payload_digest),
            attemptId: asString(row.attempt_id),
            sealedAt: asString(row.sealed_at),
            idempotent: row.idempotent === true,
          },
          error: null,
        };
      },
      async sealIntent({ operationId, attemptId, payload, payloadDigest }) {
        const { data, error } = await rpc('seal_catalog_publish_intent', {
          p_operation_id: operationId,
          p_attempt_id: attemptId,
          p_payload: payload,
          p_payload_digest: payloadDigest,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const status = asString(row.status);
        const storedDigest = asString(row.payload_digest);
        const storedAttempt = asString(row.attempt_id);
        if (status === null || storedDigest === null || storedAttempt === null) {
          return { data: null, error: null };
        }
        return {
          data: {
            operationId: asString(row.operation_id) ?? operationId,
            status,
            payloadDigest: storedDigest,
            attemptId: storedAttempt,
            sealedAt: asString(row.sealed_at),
            idempotent: row.idempotent === true,
          },
          error: null,
        };
      },
      async loadSealedPayload({ operationId, attemptId }) {
        const { data, error } = await rpc('get_catalog_publish_intent_payload', {
          p_operation_id: operationId,
          p_attempt_id: attemptId,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const payload = asString(row.payload);
        const payloadDigest = asString(row.payload_digest);
        if (payload === null || payloadDigest === null) {
          return { data: null, error: null };
        }
        return { data: { payload, payloadDigest }, error: null };
      },
      async acquireLease({ operationId, leaseSeconds, attemptId }) {
        const { data, error } = await rpc('acquire_catalog_publish_lease', {
          p_operation_id: operationId,
          p_lease_seconds: leaseSeconds,
          p_attempt_id: attemptId,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const returnedToken = asString(row.lease_token);
        const returnedExpiry = asString(row.lease_expires_at);
        const returnedGeneration = asNumber(row.state_generation);
        if (
          returnedToken === null ||
          returnedExpiry === null ||
          returnedGeneration === null
        ) {
          return { data: null, error: null };
        }
        return {
          data: {
            leaseToken: returnedToken,
            leaseExpiresAt: returnedExpiry,
            stateGeneration: returnedGeneration,
          },
          error: null,
        };
      },
      async assertLease({ operationId, leaseToken, attemptId }) {
        const { data, error } = await rpc('assert_catalog_publish_lease', {
          p_operation_id: operationId,
          p_lease_token: leaseToken,
          p_attempt_id: attemptId,
        });
        if (error) return { data: null, error };
        if (data === true) return { data: true, error: null };
        if (data === false) return { data: false, error: null };
        return { data: null, error: null };
      },
      async renewLease({ operationId, leaseToken, leaseSeconds, attemptId }) {
        const { error } = await rpc('renew_catalog_publish_lease', {
          p_operation_id: operationId,
          p_lease_token: leaseToken,
          p_lease_seconds: leaseSeconds,
          p_attempt_id: attemptId,
        });
        return { error: error ?? null };
      },
      async releaseLease({ operationId, leaseToken, attemptId }) {
        const { error } = await rpc('release_catalog_publish_lease', {
          p_operation_id: operationId,
          p_lease_token: leaseToken,
          p_attempt_id: attemptId,
        });
        return { error: error ?? null };
      },
      async commit(input) {
        const { data, error } = await rpc('commit_catalog_publish', {
          p_operation_id: input.operationId,
          p_lease_token: input.leaseToken,
          p_actor_id: input.actorId,
          p_expected_generation: input.expectedGeneration,
          p_release_id: input.releaseId,
          p_generated_at: input.generatedAt,
          p_app_count: input.appCount,
          p_category_count: input.categoryCount,
          p_attempt_id: input.attemptId,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const outcome = row.outcome;
        if (outcome !== 'committed' && outcome !== 'failed') {
          return { data: null, error: null };
        }
        return {
          data: {
            releaseId: asString(row.release_id),
            generation: asNumber(row.generation),
            committedAt: asString(row.committed_at),
            idempotent: row.idempotent === true,
            outcome,
            failureCode: asString(row.failure_code),
          },
          error: null,
        };
      },
      async getResult({ operationId, attemptId, actorId: resultActorId, releaseId }) {
        const { data, error } = await rpc('get_catalog_publish_result', {
          p_operation_id: operationId,
          p_attempt_id: attemptId,
          p_actor_id: resultActorId,
          p_release_id: releaseId,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const returnedOperation = asString(row.operation_id);
        const returnedRelease = asString(row.release_id);
        const generation = asNumber(row.generation);
        const committedAt = asString(row.committed_at);
        const generatedAt = asString(row.generated_at);
        const appCount = asNumber(row.app_count);
        const categoryCount = asNumber(row.category_count);
        const returnedActor = asString(row.actor_id);
        const currentGeneration = asNumber(row.current_generation);
        const isCurrent = row.is_current;
        if (
          returnedOperation === null ||
          returnedRelease === null ||
          generation === null ||
          committedAt === null ||
          generatedAt === null ||
          appCount === null ||
          categoryCount === null ||
          returnedActor === null ||
          currentGeneration === null ||
          typeof isCurrent !== 'boolean'
        ) {
          return { data: null, error: null };
        }
        return {
          data: {
            operationId: returnedOperation,
            releaseId: returnedRelease,
            generation,
            committedAt,
            generatedAt,
            appCount,
            categoryCount,
            actorId: returnedActor,
            isCurrent,
            currentGeneration,
          },
          error: null,
        };
      },
      async claimManifest({ operationId, attemptId, actorId: claimActorId, releaseId, claimSeconds }) {
        const { data, error } = await rpc('claim_catalog_manifest', {
          p_operation_id: operationId,
          p_attempt_id: attemptId,
          p_actor_id: claimActorId,
          p_release_id: releaseId,
          p_claim_seconds: claimSeconds,
        });
        if (error) return { data: null, error };
        const row = rpcRow(data);
        if (!row) return { data: null, error: null };
        const claimToken = asString(row.claim_token);
        const claimExpiresAt = asString(row.claim_expires_at);
        const generation = asNumber(row.generation);
        const returnedRelease = asString(row.release_id);
        const generatedAt = asString(row.generated_at);
        const appCount = asNumber(row.app_count);
        const categoryCount = asNumber(row.category_count);
        if (
          claimToken === null ||
          claimExpiresAt === null ||
          generation === null ||
          returnedRelease === null ||
          generatedAt === null ||
          appCount === null ||
          categoryCount === null
        ) {
          return { data: null, error: null };
        }
        return {
          data: {
            claimToken,
            claimExpiresAt,
            generation,
            releaseId: returnedRelease,
            generatedAt,
            appCount,
            categoryCount,
            idempotent: row.idempotent === true,
          },
          error: null,
        };
      },
      async assertManifestClaim({ operationId, claimToken, attemptId, actorId: claimActorId }) {
        const { data, error } = await rpc('assert_catalog_manifest_claim', {
          p_operation_id: operationId,
          p_claim_token: claimToken,
          p_attempt_id: attemptId,
          p_actor_id: claimActorId,
        });
        if (error) return { data: null, error };
        return { data: data === true, error: null };
      },
      async releaseManifestClaim({ operationId, claimToken, attemptId, actorId: claimActorId }) {
        const { error } = await rpc('release_catalog_manifest_claim', {
          p_operation_id: operationId,
          p_claim_token: claimToken,
          p_attempt_id: attemptId,
          p_actor_id: claimActorId,
        });
        return { error };
      },
      async downloadManifest() {
        const { data, error } = await client.storage
          .from(CATALOG_BUCKET)
          .download('manifest.json');
        if (error) {
          return isStorageNotFound(error)
            ? { data: null, error: null }
            : { data: null, error };
        }
        if (!data) return { data: null, error: null };
        const downloaded: unknown = data;
        const text =
          typeof downloaded === 'string'
            ? downloaded
            : await (downloaded as Blob).text();
        return { data: text, error: null };
      },
      async loadCards() {
        const { data, error } = await client
          .from('catalog_app_cards')
          .select(
            'app_id, slug, title, short_description, icon_path, category_id, category_name, category_slug, featured, download_count, version_id, version_name, version_code, version_changelog, apk_path, apk_size_bytes, sha256, published_at, download_source, apk_url, supports_mobile, supports_tv, account_requirement',
          )
          // A10.36 S1 — explicit order so the same catalog serializes to the
          // same bytes on every run; the builder sorts defensively as well.
          .order('app_id', { ascending: true });
        return { data: (data ?? null) as readonly CatalogCardRow[] | null, error };
      },
      async loadCategories() {
        const { data, error } = await client
          .from('categories')
          .select('id, slug, name, position')
          .eq('is_active', true)
          .order('position', { ascending: true })
          // `position` is not unique; the id tiebreak keeps equal positions
          // stable instead of leaving the array order to the planner.
          .order('id', { ascending: true });
        if (error) return { data: null, error };
        return {
          data: (data ?? []).map(category =>
            Object.freeze({
              id: category.id,
              slug: category.slug,
              name: category.name,
              position: category.position,
            }),
          ),
          error: null,
        };
      },
      async upload(file, body, releaseId) {
        const isManifest = file === 'manifest.json';
        const path = isManifest ? file : `releases/${releaseId}/${file}`;
        // `body` is already the exact sealed file text, measured before the
        // seal: nothing is re-serialized on the way to Storage.
        const uploaded = await client.storage.from(CATALOG_BUCKET).upload(path, body, {
          contentType: 'application/json',
          // Release files are immutable (never overwritten) and safe to cache
          // long; the manifest is the single mutable pointer clients read last,
          // so it gets a short TTL (no immediate CDN purge is guaranteed).
          cacheControl: isManifest
            ? CATALOG_JSON_MANIFEST_CACHE_CONTROL
            : CATALOG_JSON_RELEASE_CACHE_CONTROL,
          // Release files are immutable (never overwritten); the manifest is
          // the single mutable pointer clients read last.
          upsert: isManifest,
        });
        if (!isManifest && uploaded.error && isDuplicateStorageObject(uploaded.error)) {
          // Immutable path: the object already holds these bytes.
          return { error: null };
        }
        return { error: uploaded.error };
      },
      createGeneratedAt: () => new Date().toISOString(),
    });

    if (result.error && recordAudit) {
      try {
        await recordAudit({
          actorId: identity.userId,
          action: 'catalog.refresh_failed',
          targetType: 'catalog',
          targetId: 'catalog',
          metadata: { code: result.error.code },
        });
      } catch {
        // Audit is best-effort; the caller already holds the refresh warning.
      }
    }
    return result;
  };
}
