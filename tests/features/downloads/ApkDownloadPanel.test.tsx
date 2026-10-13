import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { ApkDownloadDependencies } from '../../../src/features/downloads/apk-download';
import { ApkDownloadPanel } from '../../../src/features/downloads/ApkDownloadPanel';

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

function dependencies(): ApkDownloadDependencies {
  return {
    resolveApkUrl: jest.fn(() => 'https://project.supabase.co/app.apk'),
    prepareDestination: jest.fn(async () => 'file:///cache/app.apk'),
    createTask: jest.fn((_url, _destination, onProgress) => {
      onProgress({ bytesWritten: 12, totalBytes: 24 });
      return {
        cancel: jest.fn(),
        download: jest.fn(() => new Promise(() => undefined)),
        release: jest.fn(),
      };
    }),
    verifyApk: jest.fn(async () => undefined),
    removeFile: jest.fn(async () => undefined),
    openInstaller: jest.fn(async () => undefined),
    markVersionDownloaded: jest.fn(async () => undefined),
    getInstallationId: jest.fn(async () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    recordDownload: jest.fn(async () => true),
    warn: jest.fn(),
  };
}

describe('ApkDownloadPanel', () => {
  it('shows progress and cancellation while downloading inside the app', async () => {
    render(<ApkDownloadPanel action="download" dependencies={dependencies()} input={input} />);

    fireEvent.press(screen.getByRole('button', { name: 'APK İNDİR' }));

    await screen.findByText('%50 · 0.0 / 0.0 MB');
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 100, now: 50, text: '%50' });
    expect(screen.getByRole('button', { name: 'İptal' })).toBeTruthy();
  });

  it('announces cancellation and hides actions until native cleanup settles', async () => {
    const download = deferred<{ uri: string; size: number }>();
    const deps = dependencies();
    (deps.createTask as jest.Mock).mockReturnValue({
      cancel: jest.fn(),
      download: jest.fn(() => download.promise),
      release: jest.fn(),
    });
    render(<ApkDownloadPanel action="download" dependencies={deps} input={input} />);

    fireEvent.press(screen.getByRole('button', { name: 'APK İNDİR' }));
    fireEvent.press(await screen.findByRole('button', { name: 'İptal' }));

    expect(screen.getByRole('alert')).toHaveTextContent('İndirme iptal edildi. Kısmi dosya temizleniyor.');
    expect(screen.queryByRole('button', { name: 'İptal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'APK İNDİR' })).toBeNull();

    await act(async () => download.reject(new Error('native cancellation settled')));

    expect(await screen.findByRole('button', { name: 'APK İNDİR' })).toBeTruthy();
  });

  it('shows a re-install action after download and automatic installer launch', async () => {
    const deps = dependencies();
    (deps.createTask as jest.Mock).mockReturnValue({
      cancel: jest.fn(),
      download: jest.fn(async () => ({ uri: 'file:///cache/app.apk', size: 24 })),
      release: jest.fn(),
    });
    render(<ApkDownloadPanel action="update" dependencies={deps} input={input} />);

    fireEvent.press(screen.getByRole('button', { name: 'GÜNCELLE' }));

    await waitFor(() => expect(deps.openInstaller).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'TEKRAR KUR' })).toBeTruthy();
    expect(screen.getByText('APK doğrulandı. Kurulum Android tarafından tamamlanır.')).toBeTruthy();
  });
});
