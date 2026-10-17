import { z } from 'zod';

export const APK_MAX_BYTES = 524_288_000;
export const HOSTED_STORAGE_MAX_BYTES = 50_000_000;
export const APK_MIME_TYPES = [
  'application/vnd.android.package-archive',
  'application/octet-stream',
] as const;

export const operationPath = /^operations\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/source\.apk$/;

const packageNameSchema = z.string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/);

const draftMetadataShape = {
  appId: z.string().uuid(),
  packageName: packageNameSchema,
  versionName: z.string().trim().min(1).max(40),
  versionCode: z.number().int().positive().max(2_147_483_647),
  changelog: z.string().trim().max(5000),
  size: z.number().int().positive().max(APK_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
};

export const storageDraftInputSchema = z.object({
  ...draftMetadataShape,
  size: z.number().int().positive().max(HOSTED_STORAGE_MAX_BYTES),
  source: z.literal('storage'),
  operationId: z.string().uuid(),
}).strict();

export const externalDraftInputSchema = z.object({
  ...draftMetadataShape,
  source: z.literal('external'),
  fileName: z.string().trim().toLowerCase().refine(name => name.endsWith('.apk')),
  apkUrl: z.string().trim().min(1).max(2048),
}).strict();

export const apkDraftInputSchema = z.discriminatedUnion('source', [
  storageDraftInputSchema,
  externalDraftInputSchema,
]);

export const uploadIntentSchema = z.object({
  appId: z.string().uuid(),
  fileName: z.string().trim().toLowerCase().refine(name => name.endsWith('.apk')),
  mimeType: z.enum(APK_MIME_TYPES),
  size: z.number().int().positive().max(APK_MAX_BYTES),
});

export const finalizeUploadSchema = storageDraftInputSchema;
