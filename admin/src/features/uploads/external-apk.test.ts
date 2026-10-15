import { describe, expect, it } from 'vitest';

import {
  HOSTED_STORAGE_MAX_BYTES,
  parseExternalApkUrl,
  verifyLocalApkMagic,
} from './external-apk';

describe('external APK validation', () => {
  it('keeps the hosted Storage threshold at exactly 50,000,000 bytes', () => {
    expect(HOSTED_STORAGE_MAX_BYTES).toBe(50_000_000);
  });

  it('normalizes a public direct HTTPS URL and hostname', () => {
    expect(parseExternalApkUrl(' HTTPS://DOWNLOADS.EXAMPLE.COM/releases/app.apk ')).toEqual({
      url: 'https://downloads.example.com/releases/app.apk',
      hostname: 'downloads.example.com',
    });
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
  ])('rejects a non-public or stateful URL: %s', value => {
    expect(() => parseExternalApkUrl(value)).toThrow('Geçerli bir herkese açık HTTPS APK bağlantısı gir.');
  });

  it('accepts only the exact ZIP local-file signature', async () => {
    await expect(verifyLocalApkMagic(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])]))).resolves.toBeUndefined();
    await expect(verifyLocalApkMagic(new Blob([new Uint8Array([0x50, 0x4b, 0x03])]))).rejects.toThrow(
      'Seçilen dosya geçerli bir APK değil.',
    );
    await expect(verifyLocalApkMagic(new Blob([new Uint8Array([0x50, 0x4b, 0x05, 0x06])]))).rejects.toThrow(
      'Seçilen dosya geçerli bir APK değil.',
    );
  });
});
