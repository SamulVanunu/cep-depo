import { resolveApkSourceUrl } from '../../../src/features/downloads/apk-source';

const storageUrl = jest.fn((path: string) => `https://project.supabase.co/storage/v1/object/public/apks/${path}`);

describe('resolveApkSourceUrl', () => {
  beforeEach(() => storageUrl.mockClear());

  it('resolves a Storage path through the public bucket helper', () => {
    expect(resolveApkSourceUrl(
      { kind: 'storage', path: 'apps/app-1/versions/version-1.apk' },
      storageUrl,
    )).toBe('https://project.supabase.co/storage/v1/object/public/apks/apps/app-1/versions/version-1.apk');
    expect(storageUrl).toHaveBeenCalledWith('apps/app-1/versions/version-1.apk');
  });

  it('passes a valid public direct HTTPS source unchanged', () => {
    const url = 'https://downloads.example.com/releases/app.apk';
    expect(resolveApkSourceUrl({ kind: 'external', url }, storageUrl)).toBe(url);
    expect(storageUrl).not.toHaveBeenCalled();
  });

  it.each([
    'http://downloads.example.com/app.apk',
    '//downloads.example.com/app.apk',
    'https://user:password@downloads.example.com/app.apk',
    'https://downloads.example.com/app.apk?token=secret',
    'https://downloads.example.com/app.apk#fragment',
    'https://localhost/app.apk',
    'https://preview.localhost/app.apk',
    'https://intranet/app.apk',
    'https://downloads.local/app.apk',
    'https://downloads.internal/app.apk',
    'https://downloads.lan/app.apk',
    'https://downloads.home/app.apk',
    'https://downloads.home.arpa/app.apk',
    'https://downloads.corp/app.apk',
    'https://downloads.private/app.apk',
    'https://downloads.test/app.apk',
    'https://downloads.invalid/app.apk',
    'https://downloads.onion/app.apk',
    'https://0.1.2.3/app.apk',
    'https://10.0.0.1/app.apk',
    'https://100.64.0.1/app.apk',
    'https://127.0.0.1/app.apk',
    'https://169.254.1.1/app.apk',
    'https://172.16.0.1/app.apk',
    'https://172.31.255.255/app.apk',
    'https://192.168.1.1/app.apk',
    'https://[::]/app.apk',
    'https://[::1]/app.apk',
    'https://[fc00::1]/app.apk',
    'https://[fd12::1]/app.apk',
    'https://[fe80::1]/app.apk',
    'https://[::ffff:192.168.1.1]/app.apk',
  ])('rejects unsafe external input before resolving Storage: %s', url => {
    expect(() => resolveApkSourceUrl({ kind: 'external', url }, storageUrl)).toThrow(
      'Güvenli APK adresi oluşturulamadı.',
    );
    expect(storageUrl).not.toHaveBeenCalled();
  });

  it('rejects malformed Storage paths', () => {
    expect(() => resolveApkSourceUrl({ kind: 'storage', path: '../secret.apk' }, storageUrl)).toThrow(
      'Güvenli APK adresi oluşturulamadı.',
    );
    expect(storageUrl).not.toHaveBeenCalled();
  });
});
