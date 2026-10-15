import type { ApkSource } from '../catalog/catalog.types';
import { ApkDownloadError } from './apk-error';
import { resolveApkSourceUrl } from './apk-source';

export { ApkDownloadError } from './apk-error';

export type ApkDownloadInput = Readonly<{
  appId: string;
  versionId: string;
  versionCode: number;
  apkSource: ApkSource;
  apkSizeBytes: number;
  sha256: string;
}>;

export type DownloadedApk = Readonly<{ uri: string; size: number }>;
export type ApkDownloadProgress = Readonly<{
  bytesWritten: number;
  totalBytes: number;
  fraction: number;
}>;

type NativeDownloadTask = Readonly<{
  download(): Promise<DownloadedApk | null>;
  cancel(): void;
  release(): void;
}>;

export type ApkDownloadDependencies = Readonly<{
  publicStorageUrl(path: string): string;
  prepareDestination(input: ApkDownloadInput): Promise<string>;
  createTask(
    url: string,
    destination: string,
    onProgress: (progress: Readonly<{ bytesWritten: number; totalBytes: number }>) => void,
  ): NativeDownloadTask;
  verifyApk(file: DownloadedApk, expected: Readonly<{ size: number; sha256: string }>): Promise<void>;
  removeFile(uri: string): Promise<void>;
  openInstaller(file: DownloadedApk): Promise<void>;
  markVersionDownloaded(appId: string, versionCode: number): Promise<void>;
  getInstallationId(): Promise<string>;
  recordDownload(versionId: string, installationId: string): Promise<boolean>;
  warn(message: string): void;
}>;

export class ApkDownloadCancelledError extends Error {
  constructor() {
    super('APK indirmesi iptal edildi.');
    this.name = 'ApkDownloadCancelledError';
  }
}

async function removePartialFile(uri: string | null, dependencies: ApkDownloadDependencies) {
  if (!uri) return;
  try {
    await dependencies.removeFile(uri);
  } catch {
    dependencies.warn('Kısmi APK dosyası temizlenemedi.');
  }
}

export function createApkDownloadOperation(
  input: ApkDownloadInput,
  dependencies: ApkDownloadDependencies,
  onProgress: (progress: ApkDownloadProgress) => void,
) {
  let cancelled = false;
  let destination: string | null = null;
  let task: NativeDownloadTask | null = null;

  return {
    async download(): Promise<DownloadedApk> {
      const url = resolveApkSourceUrl(input.apkSource, dependencies.publicStorageUrl);
      try {
        destination = await dependencies.prepareDestination(input);
        if (cancelled) throw new ApkDownloadCancelledError();
        task = dependencies.createTask(url, destination, progress => {
          const totalBytes = progress.totalBytes > 0 ? progress.totalBytes : input.apkSizeBytes;
          const bytesWritten = Math.max(0, progress.bytesWritten);
          onProgress({
            bytesWritten,
            totalBytes,
            fraction: Math.min(1, Math.max(0, bytesWritten / totalBytes)),
          });
        });
        if (cancelled) {
          task.cancel();
          throw new ApkDownloadCancelledError();
        }
        let file: DownloadedApk | null;
        try {
          file = await task.download();
        } catch {
          if (cancelled) throw new ApkDownloadCancelledError();
          throw new ApkDownloadError('network');
        }
        if (cancelled) throw new ApkDownloadCancelledError();
        if (!file) throw new ApkDownloadError('network');
        await dependencies.verifyApk(file, { size: input.apkSizeBytes, sha256: input.sha256 });
        return file;
      } catch (error) {
        await removePartialFile(destination, dependencies);
        if (cancelled) throw new ApkDownloadCancelledError();
        throw error;
      } finally {
        task?.release();
      }
    },
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  } as const;
}

export async function launchApkInstaller(
  file: DownloadedApk,
  input: ApkDownloadInput,
  dependencies: ApkDownloadDependencies,
): Promise<{ metricsRecorded: boolean }> {
  await dependencies.openInstaller(file);
  await dependencies.markVersionDownloaded(input.appId, input.versionCode);
  try {
    const installationId = await dependencies.getInstallationId();
    const metricsRecorded = await dependencies.recordDownload(input.versionId, installationId);
    return { metricsRecorded };
  } catch {
    dependencies.warn('İndirme metriği kaydedilemedi.');
    return { metricsRecorded: false };
  }
}
