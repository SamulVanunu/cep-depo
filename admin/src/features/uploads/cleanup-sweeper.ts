import { RUN_BUDGET_MS, SWEEP_FOLDER_LIMIT, SWEEP_GRACE_MS } from './cleanup-config';
import {
  CLEANUP_BUCKETS,
  managedTarget,
  type SweepBucket,
  type CleanupTargetType,
  type ManagedTarget,
} from './cleanup-paths';

// The sweeper only ever enqueues: there is deliberately no remove dependency
// here, so no sweep code path can delete an object.

export type SweepCounters = Readonly<{ scanned: number; enqueued: number }>;

export type StorageEntry = Readonly<{
  name: string;
  isFolder: boolean;
  createdAt: string | null;
}>;

export type SweepCursor = Readonly<{
  bucket: SweepBucket;
  lastFolder: string | null;
}>;

export type SweepDependencies = Readonly<{
  loadCursor(): Promise<SweepCursor>;
  saveCursor(next: SweepCursor): Promise<void>;
  list(
    bucket: string,
    prefix: string,
    offset: number,
  ): Promise<Readonly<{ entries: readonly StorageEntry[]; hasMore: boolean }>>;
  isReferenced(bucket: string, path: string): Promise<boolean>;
  enqueueOrphan(input: ManagedTarget): Promise<string | null>;
  now(): number;
}>;

async function listAll(
  dependencies: SweepDependencies,
  bucket: string,
  prefix: string,
): Promise<readonly StorageEntry[]> {
  const entries: StorageEntry[] = [];
  let offset = 0;

  for (;;) {
    const page = await dependencies.list(bucket, prefix, offset);
    entries.push(...page.entries);

    if (!page.hasMore || page.entries.length === 0) break;
    offset += page.entries.length;
  }

  return entries;
}

/**
 * A folder unit is the deepest container that holds cleanable files:
 * `operations/<op>` for drafts, `apps/<app>` for versions and app assets.
 * Both live exactly two levels below the bucket root.
 */
async function listUnits(
  dependencies: SweepDependencies,
  bucket: SweepBucket,
): Promise<readonly string[]> {
  const roots = (await listAll(dependencies, bucket, '')).filter(entry => entry.isFolder);
  const units: string[] = [];

  for (const root of roots) {
    const children = (await listAll(dependencies, bucket, `${root.name}/`)).filter(
      entry => entry.isFolder,
    );
    for (const child of children) units.push(`${root.name}/${child.name}`);
  }

  return units.sort();
}

async function listUnitFiles(
  dependencies: SweepDependencies,
  bucket: SweepBucket,
  unit: string,
): Promise<readonly Readonly<{ path: string; createdAt: string | null }>[]> {
  const prefixes =
    bucket === 'apk-drafts'
      ? [`${unit}/`]
      : bucket === 'apks'
        ? [`${unit}/versions/`]
        : [`${unit}/icons/`, `${unit}/screenshots/`];

  const files: Array<Readonly<{ path: string; createdAt: string | null }>> = [];
  for (const prefix of prefixes) {
    for (const entry of await listAll(dependencies, bucket, prefix)) {
      if (entry.isFolder) continue;
      files.push({ path: `${prefix}${entry.name}`, createdAt: entry.createdAt });
    }
  }

  return files;
}

function targetTypeFor(bucket: SweepBucket, path: string): CleanupTargetType | null {
  if (bucket === 'apk-drafts') return 'apk_draft';
  if (bucket === 'apks') return 'apk';
  if (path.includes('/icons/')) return 'icon';
  if (path.includes('/screenshots/')) return 'screenshot';
  return null;
}

/**
 * One run sweeps one bucket, resumable by folder. When the bucket is
 * exhausted the cursor advances to the next bucket (app-assets wraps back to
 * apk-drafts); when a limit stops the run, the cursor keeps the last fully
 * processed folder so the next run continues where this one stopped.
 */
export async function runCleanupSweep(
  dependencies: SweepDependencies,
): Promise<SweepCounters> {
  const counters = { scanned: 0, enqueued: 0 };

  const cursor = await dependencies.loadCursor();
  const startIndex = Math.max(0, CLEANUP_BUCKETS.indexOf(cursor.bucket));
  const bucket = CLEANUP_BUCKETS[startIndex];
  const deadline = dependencies.now() + RUN_BUDGET_MS;

  const units = await listUnits(dependencies, bucket);
  let lastFolder = cursor.lastFolder;
  let folders = 0;

  for (const unit of units) {
    if (lastFolder !== null && unit <= lastFolder) continue;

    if (folders >= SWEEP_FOLDER_LIMIT || dependencies.now() >= deadline) {
      await dependencies.saveCursor({ bucket, lastFolder });
      return counters;
    }

    lastFolder = unit;
    folders += 1;

    for (const entry of await listUnitFiles(dependencies, bucket, unit)) {
      counters.scanned += 1;

      const targetType = targetTypeFor(bucket, entry.path);
      if (!targetType) continue;

      const target = managedTarget(bucket, entry.path, targetType);
      if (!target) continue;

      // No timestamp means we cannot prove the object is old enough: skip it
      // rather than risk queueing a file that is still being written.
      if (entry.createdAt === null) continue;

      const createdAt = Date.parse(entry.createdAt);
      if (!Number.isFinite(createdAt) || createdAt > dependencies.now() - SWEEP_GRACE_MS) {
        continue;
      }

      if (await dependencies.isReferenced(bucket, entry.path)) continue;

      const jobId = await dependencies.enqueueOrphan(target);
      if (jobId !== null) counters.enqueued += 1;
    }

    if (dependencies.now() >= deadline) {
      await dependencies.saveCursor({ bucket, lastFolder });
      return counters;
    }
  }

  const next = CLEANUP_BUCKETS[(startIndex + 1) % CLEANUP_BUCKETS.length];
  await dependencies.saveCursor({ bucket: next, lastFolder: null });
  return counters;
}
