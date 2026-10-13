import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApkDownloadCancelledError,
  type ApkDownloadDependencies,
  type ApkDownloadInput,
  type ApkDownloadProgress,
  createApkDownloadOperation,
  type DownloadedApk,
  launchApkInstaller,
} from './apk-download';
import { defaultApkDownloadDependencies } from './native-apk-download';

type DownloadPhase = 'idle' | 'downloading' | 'installing' | 'ready' | 'error';

const initialProgress: ApkDownloadProgress = {
  bytesWritten: 0,
  totalBytes: 0,
  fraction: 0,
};

export function useApkDownload(
  input: ApkDownloadInput,
  dependencies: ApkDownloadDependencies = defaultApkDownloadDependencies,
  onInstallerOpened: () => Promise<unknown> = async () => undefined,
) {
  const [phase, setPhase] = useState<DownloadPhase>('idle');
  const [progress, setProgress] = useState(initialProgress);
  const [downloadedApk, setDownloadedApk] = useState<DownloadedApk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef<ReturnType<typeof createApkDownloadOperation> | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    operationRef.current?.cancel();
  }, []);

  const openInstaller = useCallback(async (file: DownloadedApk) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase('installing');
    setError(null);
    try {
      await launchApkInstaller(file, input, dependencies);
      if (!mountedRef.current) return;
      await onInstallerOpened();
      if (mountedRef.current) setPhase('ready');
    } catch {
      if (mountedRef.current) {
        setError('Kurulum ekranı açılamadı.');
        setPhase('ready');
      }
    } finally {
      busyRef.current = false;
    }
  }, [dependencies, input, onInstallerOpened]);

  const start = useCallback(async () => {
    if (busyRef.current || operationRef.current) return;
    busyRef.current = true;
    setError(null);
    setDownloadedApk(null);
    setProgress({ ...initialProgress, totalBytes: input.apkSizeBytes });
    setPhase('downloading');
    const operation = createApkDownloadOperation(input, dependencies, nextProgress => {
      if (mountedRef.current) setProgress(nextProgress);
    });
    operationRef.current = operation;
    try {
      const file = await operation.download();
      operationRef.current = null;
      if (!mountedRef.current) return;
      setDownloadedApk(file);
      busyRef.current = false;
      await openInstaller(file);
    } catch (downloadError) {
      operationRef.current = null;
      busyRef.current = false;
      if (!mountedRef.current) return;
      if (downloadError instanceof ApkDownloadCancelledError) {
        setPhase('idle');
        return;
      }
      setError('APK indirilemedi veya doğrulanamadı.');
      setPhase('error');
    }
  }, [dependencies, input, openInstaller]);

  const cancel = useCallback(() => {
    if (!operationRef.current) return;
    operationRef.current.cancel();
    setError(null);
    setPhase('idle');
  }, []);

  const install = useCallback(async () => {
    if (downloadedApk) await openInstaller(downloadedApk);
  }, [downloadedApk, openInstaller]);

  return { phase, progress, error, start, cancel, install } as const;
}
