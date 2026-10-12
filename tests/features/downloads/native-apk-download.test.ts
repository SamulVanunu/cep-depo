import { installerIntentParams } from '../../../src/features/downloads/native-apk-download';

describe('installerIntentParams', () => {
  it('grants temporary read access and opens the Android package installer', () => {
    expect(installerIntentParams('content://com.cepdepo.app/cache/app.apk')).toEqual({
      data: 'content://com.cepdepo.app/cache/app.apk',
      type: 'application/vnd.android.package-archive',
      flags: 0x10000001,
    });
  });

  it('rejects file URIs that cannot be shared safely with another Android app', () => {
    expect(() => installerIntentParams('file:///cache/app.apk')).toThrow(
      'APK installer adresi oluşturulamadı.',
    );
  });
});
