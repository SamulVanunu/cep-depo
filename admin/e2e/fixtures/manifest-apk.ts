import { createValidApk } from '../../src/features/uploads/fixtures/manifest-apk';

export const onePixelPng = {
  name: 'pixel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
};

export async function manifestApk({
  packageName,
  versionName,
  versionCode,
}: Readonly<{
  packageName: string;
  versionName: string;
  versionCode: number;
}>) {
  const apk = await createValidApk({ packageName, versionName, versionCode });
  return {
    name: `${packageName}-${versionCode}.apk`,
    mimeType: 'application/vnd.android.package-archive',
    buffer: Buffer.from(await apk.arrayBuffer()),
  };
}
