'use server';

import { z } from 'zod';

import { ActionException } from '../../server/errors/action-error';

export type CleanupAsset = Readonly<{
  bucket: 'apk-drafts' | 'apks' | 'app-assets';
  path: string;
  operationId: string;
  targetType: 'apk_draft' | 'apk' | 'icon' | 'screenshot';
}>;

type CleanupError = Readonly<{ code?: string }> | null;

export type CleanupDependencies = Readonly<{
  remove(bucket: CleanupAsset['bucket'], path: string): Promise<{ error: unknown | null }>;
  enqueue(asset: CleanupAsset): Promise<{ error: CleanupError }>;
  complete(asset: CleanupAsset): Promise<{ error: unknown | null }>;
}>;

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const cleanupAssetSchema = z.discriminatedUnion('targetType', [
  z.object({
    bucket: z.literal('apk-drafts'),
    path: z.string().regex(new RegExp(`^operations/${uuid}/source\\.apk$`)),
    operationId: z.string().uuid(),
    targetType: z.literal('apk_draft'),
  }),
  z.object({
    bucket: z.literal('apks'),
    path: z.string().regex(new RegExp(`^apps/${uuid}/versions/${uuid}\\.apk$`)),
    operationId: z.string().uuid(),
    targetType: z.literal('apk'),
  }),
  z.object({
    bucket: z.literal('app-assets'),
    path: z.string().regex(new RegExp(`^apps/${uuid}/icons/${uuid}\\.(png|jpg|webp)$`)),
    operationId: z.string().uuid(),
    targetType: z.literal('icon'),
  }),
  z.object({
    bucket: z.literal('app-assets'),
    path: z.string().regex(new RegExp(`^apps/${uuid}/screenshots/${uuid}\\.(png|jpg|webp)$`)),
    operationId: z.string().uuid(),
    targetType: z.literal('screenshot'),
  }),
]);

export async function removeOrEnqueueAssets(
  assets: readonly CleanupAsset[],
  dependencies: CleanupDependencies,
): Promise<{ pending: number }> {
  let validated: CleanupAsset[];
  try {
    validated = assets.map(asset => cleanupAssetSchema.parse(asset) as CleanupAsset);
  } catch {
    throw new ActionException('VALIDATION');
  }

  let pending = 0;
  for (const asset of validated) {
    let removalFailed = true;
    try {
      const removal = await dependencies.remove(asset.bucket, asset.path);
      removalFailed = Boolean(removal.error);
    } catch {
      removalFailed = true;
    }

    if (!removalFailed) {
      try {
        const completed = await dependencies.complete(asset);
        if (completed.error) pending += 1;
      } catch {
        pending += 1;
      }
      continue;
    }

    try {
      await dependencies.enqueue(asset);
    } catch {
      // A transaction-backed outbox may already contain the job. Operational
      // enqueue failures must not prevent later assets from being attempted.
    }
    pending += 1;
  }

  return { pending };
}
