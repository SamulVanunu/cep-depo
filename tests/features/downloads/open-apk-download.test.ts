import { openApkDownload } from '../../../src/features/downloads/open-apk-download';

const input = {
  appId: 'app-1',
  versionId: 'version-12',
  versionCode: 12,
  apkPath: 'apps/app-1/versions/version-12.apk',
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    resolveApkUrl: jest.fn(() => 'https://project.supabase.co/storage/v1/object/public/apks/app.apk'),
    openUrl: jest.fn(async () => undefined),
    markVersionDownloaded: jest.fn(async () => undefined),
    getInstallationId: jest.fn(async () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    recordDownload: jest.fn(async () => true),
    warn: jest.fn(),
    ...overrides,
  };
}

describe('openApkDownload', () => {
  it('does not write history or metrics when URL opening rejects', async () => {
    const deps = dependencies({ openUrl: jest.fn(async () => Promise.reject(new Error('blocked'))) });

    await expect(openApkDownload(input, deps)).rejects.toThrow('blocked');
    expect(deps.markVersionDownloaded).not.toHaveBeenCalled();
    expect(deps.recordDownload).not.toHaveBeenCalled();
  });

  it('rejects non-HTTPS URLs before invoking the platform', async () => {
    const deps = dependencies({ resolveApkUrl: jest.fn(() => 'http://unsafe.example/app.apk') });

    await expect(openApkDownload(input, deps)).rejects.toThrow('Güvenli APK adresi oluşturulamadı.');
    expect(deps.openUrl).not.toHaveBeenCalled();
  });

  it('opens first, then stores history and records one installation metric', async () => {
    const order: string[] = [];
    const deps = dependencies({
      openUrl: jest.fn(async () => { order.push('open'); }),
      markVersionDownloaded: jest.fn(async () => { order.push('history'); }),
      recordDownload: jest.fn(async () => { order.push('metric'); return true; }),
    });

    await expect(openApkDownload(input, deps)).resolves.toEqual({ metricsRecorded: true });
    expect(order).toEqual(['open', 'history', 'metric']);
    expect(deps.markVersionDownloaded).toHaveBeenCalledWith('app-1', 12);
    expect(deps.recordDownload).toHaveBeenCalledWith(
      'version-12',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    );
  });

  it('keeps a successful open and local history when metrics fail', async () => {
    const deps = dependencies({
      recordDownload: jest.fn(async () => Promise.reject(new Error('secret backend detail'))),
    });

    await expect(openApkDownload(input, deps)).resolves.toEqual({ metricsRecorded: false });
    expect(deps.markVersionDownloaded).toHaveBeenCalledWith('app-1', 12);
    expect(deps.warn).toHaveBeenCalledWith('İndirme metriği kaydedilemedi.');
    expect(deps.warn).not.toHaveBeenCalledWith(expect.stringContaining('secret backend detail'));
  });
});
