import * as tus from 'tus-js-client';

export type TusIntent = Readonly<{
  endpoint: string;
  publishableKey: string;
  bucket: 'apk-drafts';
  path: string;
  token: string;
  mimeType?: string;
}>;

export type TusCallbacks = Readonly<{
  onProgress?(uploaded: number, total: number): void;
  onError?(error: Error): void;
  onSuccess?(): void;
}>;

type TusOptions = ConstructorParameters<typeof tus.Upload>[1];
type TusInstance = Pick<tus.Upload, 'abort' | 'findPreviousUploads' | 'resumeFromPreviousUpload' | 'start'>;
export type TusUploadConstructor = new (file: File, options: TusOptions) => TusInstance;
export type TusUploadHandle = Readonly<{
  abort(shouldTerminate?: boolean): Promise<void>;
}>;

export async function startTusUpload(
  intent: TusIntent,
  file: File,
  callbacks: TusCallbacks,
  UploadConstructor: TusUploadConstructor = tus.Upload,
): Promise<TusUploadHandle> {
  const upload = new UploadConstructor(file, {
    endpoint: intent.endpoint,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    headers: { apikey: intent.publishableKey, 'x-signature': intent.token },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    chunkSize: 6 * 1024 * 1024,
    metadata: {
      bucketName: intent.bucket,
      objectName: intent.path,
      contentType: intent.mimeType || file.type || 'application/octet-stream',
      cacheControl: '3600',
    },
    onProgress: callbacks.onProgress,
    onError: callbacks.onError,
    onSuccess: callbacks.onSuccess,
  });
  const previous = await upload.findPreviousUploads();
  if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
  upload.start();
  return Object.freeze({
    abort: (shouldTerminate?: boolean) => upload.abort(shouldTerminate),
  });
}
