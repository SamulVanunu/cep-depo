import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ApkDownloadDependencies } from '../../../src/features/downloads/apk-download';
import { useApkDownload } from '../../../src/features/downloads/useApkDownload';

const input = {
  appId: 'app-1',
  versionId: 'version-12',
  versionCode: 12,
  apkPath: 'apps/app-1/versions/version-12.apk',
  apkSizeBytes: 24,
  sha256: 'a'.repeat(64),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function dependencies(download: ReturnType<typeof deferred<{ uri: string; size: number }>>) {
  const task = {
    cancel: jest.fn(() => download.reject(new Error('cancelled'))),
    download: jest.fn(() => download.promise),
    release: jest.fn(),
  };
  const deps: ApkDownloadDependencies = {
    resolveApkUrl: jest.fn(() => 'https://project.supabase.co/app.apk'),
    prepareDestination: jest.fn(async () => 'file:///cache/app.apk'),
    createTask: jest.fn((_url, _destination, onProgress) => {
      onProgress({ bytesWritten: 6, totalBytes: 24 });
      return task;
    }),
    verifyApk: jest.fn(async () => undefined),
    removeFile: jest.fn(async () => undefined),
    openInstaller: jest.fn(async () => undefined),
    markVersionDownloaded: jest.fn(async () => undefined),
    getInstallationId: jest.fn(async () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    recordDownload: jest.fn(async () => true),
    warn: jest.fn(),
  };
  return { deps, task };
}

describe('useApkDownload', () => {
  it('reports progress, verifies and automatically opens the installer', async () => {
    const download = deferred<{ uri: string; size: number }>();
    const { deps } = dependencies(download);
    const onInstallerOpened = jest.fn(async () => undefined);
    const { result } = renderHook(() => useApkDownload(input, deps, onInstallerOpened));

    act(() => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe('downloading'));
    await waitFor(() => expect(result.current.progress.fraction).toBe(0.25));

    download.resolve({ uri: 'file:///cache/app.apk', size: 24 });

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(deps.openInstaller).toHaveBeenCalledTimes(1);
    expect(onInstallerOpened).toHaveBeenCalledTimes(1);
  });

  it('cancels an active download and returns to idle without an error', async () => {
    const download = deferred<{ uri: string; size: number }>();
    const { deps, task } = dependencies(download);
    const { result } = renderHook(() => useApkDownload(input, deps));

    act(() => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe('downloading'));
    act(() => result.current.cancel());

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('shows cancellation while native cleanup settles and blocks overlapping retries', async () => {
    const download = deferred<{ uri: string; size: number }>();
    const { deps, task } = dependencies(download);
    task.cancel.mockImplementation(() => undefined);
    const { result } = renderHook(() => useApkDownload(input, deps));

    act(() => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe('downloading'));

    act(() => result.current.cancel());

    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('cancelling');
    expect(result.current.error).toBeNull();

    act(() => result.current.cancel());
    expect(task.cancel).toHaveBeenCalledTimes(1);

    act(() => { void result.current.start(); });
    expect(deps.createTask).toHaveBeenCalledTimes(1);

    download.reject(new Error('native cancellation settled'));
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(deps.openInstaller).not.toHaveBeenCalled();
    expect(deps.markVersionDownloaded).not.toHaveBeenCalled();
    expect(deps.recordDownload).not.toHaveBeenCalled();
  });

  it('cancels while preparing the destination without starting a native task', async () => {
    const download = deferred<{ uri: string; size: number }>();
    const destination = deferred<string>();
    const { deps } = dependencies(download);
    (deps.prepareDestination as jest.Mock).mockReturnValue(destination.promise);
    const { result } = renderHook(() => useApkDownload(input, deps));

    act(() => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe('downloading'));

    act(() => result.current.cancel());
    expect(result.current.phase).toBe('cancelling');

    destination.resolve('file:///cache/app.apk');

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.removeFile).toHaveBeenCalledWith('file:///cache/app.apk');
  });

  it('does not cancel the native task twice when the detail screen unmounts during cleanup', async () => {
    const download = deferred<{ uri: string; size: number }>();
    const { deps, task } = dependencies(download);
    task.cancel.mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useApkDownload(input, deps));

    act(() => { void result.current.start(); });
    await waitFor(() => expect(result.current.phase).toBe('downloading'));
    await waitFor(() => expect(deps.createTask).toHaveBeenCalledTimes(1));
    act(() => result.current.cancel());
    unmount();

    expect(task.cancel).toHaveBeenCalledTimes(1);

    download.reject(new Error('native cancellation settled'));
    await waitFor(() => expect(deps.removeFile).toHaveBeenCalledWith('file:///cache/app.apk'));
    expect(deps.openInstaller).not.toHaveBeenCalled();
    expect(deps.markVersionDownloaded).not.toHaveBeenCalled();
    expect(deps.recordDownload).not.toHaveBeenCalled();
  });

  it('keeps a verified APK ready when installer launch fails so install can be retried', async () => {
    const download = deferred<{ uri: string; size: number }>();
    const { deps } = dependencies(download);
    (deps.openInstaller as jest.Mock).mockRejectedValueOnce(new Error('blocked'));
    const { result } = renderHook(() => useApkDownload(input, deps));

    act(() => { void result.current.start(); });
    download.resolve({ uri: 'file:///cache/app.apk', size: 24 });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.error).toBe('Kurulum ekranı açılamadı.');

    await act(async () => result.current.install());
    expect(deps.openInstaller).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('offers a clean retry after download failure', async () => {
    const first = deferred<{ uri: string; size: number }>();
    const second = deferred<{ uri: string; size: number }>();
    const { deps } = dependencies(first);
    let attempt = 0;
    (deps.createTask as jest.Mock).mockImplementation((_url, _destination, onProgress) => {
      onProgress({ bytesWritten: 0, totalBytes: 24 });
      const current = attempt++ === 0 ? first : second;
      return { cancel: jest.fn(), download: () => current.promise, release: jest.fn() };
    });
    const { result } = renderHook(() => useApkDownload(input, deps));

    act(() => { void result.current.start(); });
    first.reject(new Error('offline'));
    await waitFor(() => expect(result.current.phase).toBe('error'));

    act(() => { void result.current.start(); });
    second.resolve({ uri: 'file:///cache/app.apk', size: 24 });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(deps.createTask).toHaveBeenCalledTimes(2);
  });
});
