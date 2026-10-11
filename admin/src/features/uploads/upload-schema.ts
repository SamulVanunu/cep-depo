import { z } from 'zod';

export const APK_MAX_BYTES = 524_288_000;
export const APK_MIME_TYPES = [
  'application/vnd.android.package-archive',
  'application/octet-stream',
] as const;

export const operationPath = /^operations\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/source\.apk$/;

export const uploadIntentSchema = z.object({
  appId: z.string().uuid(),
  fileName: z.string().trim().toLowerCase().refine(name => name.endsWith('.apk')),
  mimeType: z.enum(APK_MIME_TYPES),
  size: z.number().int().positive().max(APK_MAX_BYTES),
});

export const finalizeUploadSchema = z.object({
  appId: z.string().uuid(),
  operationId: z.string().uuid(),
  versionName: z.string().trim().min(1).max(40),
  versionCode: z.number().int().positive(),
  changelog: z.string().trim().max(5000),
  size: z.number().int().positive().max(APK_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
