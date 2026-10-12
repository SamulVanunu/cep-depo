import { verifyApkChunks } from '../../../src/features/downloads/verify-apk';

async function* chunks(...values: number[][]) {
  for (const value of values) yield Uint8Array.from(value);
}

describe('verifyApkChunks', () => {
  it('accepts matching size, PK bytes and SHA-256', async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0x61, 0x70, 0x6b];
    await expect(
      verifyApkChunks(
        bytes.length,
        chunks(bytes.slice(0, 3), bytes.slice(3)),
        bytes.length,
        'c71aa6ffc2a78c2a02e0d485d3cdf686492b0e5314074402b8a6d923b51de01b',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects size mismatch before hashing', async () => {
    await expect(verifyApkChunks(4, chunks([0x50, 0x4b, 0x03, 0x04]), 5, 'a'.repeat(64)))
      .rejects.toThrow('APK boyutu doğrulanamadı.');
  });

  it('rejects files without APK ZIP magic bytes', async () => {
    await expect(verifyApkChunks(4, chunks([0, 1, 2, 3]), 4, 'a'.repeat(64)))
      .rejects.toThrow('APK dosya imzası geçersiz.');
  });

  it('rejects SHA-256 mismatch', async () => {
    await expect(verifyApkChunks(4, chunks([0x50, 0x4b, 0x03, 0x04]), 4, 'a'.repeat(64)))
      .rejects.toThrow('APK özeti doğrulanamadı.');
  });
});
