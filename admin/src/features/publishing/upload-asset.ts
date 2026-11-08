'use client';

import { createBrowserSupabaseClient } from '../../lib/supabase/browser';
import {
  addScreenshotAction,
  cleanupPublishingAssetAction,
  requestAssetUploadAction,
  setAppIconAction,
} from '../apps/asset-actions';

/**
 * Uploads one publishing asset through a signed Storage URL, then attaches it
 * to the app. A failed upload or save cleans the orphaned object up and throws,
 * so callers keep their own operator-facing message.
 */
export async function uploadPublishingAsset(input: Readonly<{
  appId: string;
  operationId: string;
  kind: 'icon' | 'screenshot';
  file: File;
  altText: string;
  position: number;
}>): Promise<string> {
  const intent = await requestAssetUploadAction({
    appId: input.appId,
    kind: input.kind,
    fileName: input.file.name,
    mimeType: input.file.type,
    size: input.file.size,
  });
  if (!intent.ok) throw new Error('asset-intent-failed');
  const client = createBrowserSupabaseClient();
  const uploaded = await client.storage
    .from(intent.data.bucket)
    .uploadToSignedUrl(intent.data.path, intent.data.token, input.file, { contentType: input.file.type });
  if (uploaded.error) {
    await cleanupPublishingAssetAction({
      appId: input.appId,
      requestId: input.operationId,
      path: intent.data.path,
      kind: input.kind,
    });
    throw new Error('asset-upload-failed');
  }
  const saved = input.kind === 'icon'
    ? await setAppIconAction(input.appId, intent.data.path)
    : await addScreenshotAction({
        appId: input.appId,
        path: intent.data.path,
        altText: input.altText,
        position: input.position,
      });
  if (!saved.ok) {
    await cleanupPublishingAssetAction({
      appId: input.appId,
      requestId: input.operationId,
      path: intent.data.path,
      kind: input.kind,
    });
    throw new Error('asset-save-failed');
  }
  return intent.data.path;
}
