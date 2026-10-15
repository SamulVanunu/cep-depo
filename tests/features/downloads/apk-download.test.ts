import {
  ApkDownloadCancelledError,
  createApkDownloadOperation,
  launchApkInstaller,
} from '../../../src/features/downloads/apk-download';

const input = {
  appId: 'app-1',
  versionId: 'version-12',
  versionCode: 12,
  apkSource: { kind: 'storage' as const, path: 'apps/app-1/versions/version-12.apk' },
  apkSizeBytes: 24,
  sha256: 'a'.repeat(64),
};

function dependencies(overrides: Record<string, unknown> = {}) {
  const task = {
    cancel: jest.fn(),
    download: jest.fn(async () => ({ uri: 'file:///cache/version-12.apk', size: 24 })),
    release: jest.fn(),
  };
  return {
    task,
    deps: {
      publicStorageUrl: jest.fn(() => 'https://project.supabase.co/storage/v1/object/public/apks/app.apk'),
      prepareDestination: jest.fn(async () => 'file:///cache/version-12.apk'),
      createTask: jest.fn((
        _url: string,
        _destination: string,
        _onProgress: (progress: { bytesWritten: number; totalBytes: number }) => void,
      ) => task),
      verifyApk: jest.fn(async () => undefined),
      removeFile: jest.fn(async () => undefined),
      openInstaller: jest.fn(async () => undefined),
      markVersionDownloaded: jest.fn(async () => undefined),
      getInstallationId: jest.fn(async () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      recordDownload: jest.fn(async () => true),
      warn: jest.fn(),
      ...overrides,
    },
  };
}

describe('createApkDownloadOperation', () => {
  it('downloads, reports bounded progress and verifies before returning the file', async () => {
    const { deps, task } = dependencies();
    deps.createTask.mockImplementation((_url, _destination, onProgress) => {
      onProgress({ bytesWritten: 6, totalBytes: 24 });
      return task;
    });
    const onProgress = jest.fn();

    const operation = createApkDownloadOperation(input, deps, onProgress);

    await expect(operation.download()).resolves.toEqual({
      uri: 'file:///cache/version-12.apk',
      size: 24,
    });
    expect(onProgress).toHaveBeenCalledWith({ bytesWritten: 6, totalBytes: 24, fraction: 0.25 });
    expect(deps.verifyApk).toHaveBeenCalledWith(
      { uri: 'file:///cache/version-12.apk', size: 24 },
      { size: 24, sha256: 'a'.repeat(64) },
    );
    expect(task.release).toHaveBeenCalledTimes(1);
  });

  it('rejects non-HTTPS URLs before creating a destination', async () => {
    const unsafeInput = {
      ...input,
      apkSource: { kind: 'external' as const, url: 'http://unsafe.example/app.apk' },
    };
    const { deps } = dependencies();

    const operation = createApkDownloadOperation(unsafeInput, deps, jest.fn());

    await expect(operation.download()).rejects.toThrow('Güvenli APK adresi oluşturulamadı.');
    expect(deps.prepareDestination).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it('passes a valid external URL unchanged without invoking the Storage resolver', async () => {
    const url = 'https://downloads.example.com/releases/app.apk';
    const { deps } = dependencies();
    const operation = createApkDownloadOperation(
      { ...input, apkSource: { kind: 'external', url } },
      deps,
      jest.fn(),
    );
    await operation.download();
    expect(deps.createTask).toHaveBeenCalledWith(url, expect.any(String), expect.any(Function));
    expect(deps.publicStorageUrl).not.toHaveBeenCalled();
  });

  it('maps a native task failure to a safe network error and removes partial data', async () => {
    const { deps, task } = dependencies();
    task.download.mockRejectedValue(new Error('private native transport detail'));
    const operation = createApkDownloadOperation(input, deps, jest.fn());
    await expect(operation.download()).rejects.toThrow('APK bağlantısına ulaşılamadı.');
    expect(deps.removeFile).toHaveBeenCalledWith('file:///cache/version-12.apk');
    expect(deps.verifyApk).not.toHaveBeenCalled();
    expect(deps.openInstaller).not.toHaveBeenCalled();
    expect(deps.markVersionDownloaded).not.toHaveBeenCalled();
    expect(deps.recordDownload).not.toHaveBeenCalled();
  });

  it('cancels the native task and removes the partial file', async () => {
    let rejectDownload!: (error: Error) => void;
    const { deps, task } = dependencies();
    task.download.mockImplementation(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
    const operation = createApkDownloadOperation(input, deps, jest.fn());
    const pending = operation.download();
    await Promise.resolve();

    operation.cancel();
    rejectDownload(new Error('native cancellation'));

    await expect(pending).rejects.toBeInstanceOf(ApkDownloadCancelledError);
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(deps.removeFile).toHaveBeenCalledWith('file:///cache/version-12.apk');
    expect(deps.verifyApk).not.toHaveBeenCalled();
  });

  it('removes an invalid download and never returns it', async () => {
    const { deps } = dependencies({
      verifyApk: jest.fn(async () => Promise.reject(new Error('APK doğrulanamadı.'))),
    });
    const operation = createApkDownloadOperation(input, deps, jest.fn());

    await expect(operation.download()).rejects.toThrow('APK doğrulanamadı.');
    expect(deps.removeFile).toHaveBeenCalledWith('file:///cache/version-12.apk');
  });
});

describe('launchApkInstaller', () => {
  it('opens the installer before writing history and a best-effort metric', async () => {
    const order: string[] = [];
    const { deps } = dependencies({
      openInstaller: jest.fn(async () => { order.push('installer'); }),
      markVersionDownloaded: jest.fn(async () => { order.push('history'); }),
      recordDownload: jest.fn(async () => { order.push('metric'); return true; }),
    });

    await expect(
      launchApkInstaller({ uri: 'file:///cache/version-12.apk', size: 24 }, input, deps),
    ).resolves.toEqual({ metricsRecorded: true });
    expect(order).toEqual(['installer', 'history', 'metric']);
  });

  it('does not write history when the installer cannot open', async () => {
    const { deps } = dependencies({ openInstaller: jest.fn(async () => Promise.reject(new Error('blocked'))) });

    await expect(
      launchApkInstaller({ uri: 'file:///cache/version-12.apk', size: 24 }, input, deps),
    ).rejects.toThrow('blocked');
    expect(deps.markVersionDownloaded).not.toHaveBeenCalled();
    expect(deps.recordDownload).not.toHaveBeenCalled();
  });

  it('keeps installer success when metrics fail without exposing the backend error', async () => {
    const { deps } = dependencies({
      recordDownload: jest.fn(async () => Promise.reject(new Error('secret backend detail'))),
    });

    await expect(
      launchApkInstaller({ uri: 'file:///cache/version-12.apk', size: 24 }, input, deps),
    ).resolves.toEqual({ metricsRecorded: false });
    expect(deps.warn).toHaveBeenCalledWith('İndirme metriği kaydedilemedi.');
  });
});
