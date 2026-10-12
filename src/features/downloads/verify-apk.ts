import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const APK_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export async function verifyApkChunks(
  actualSize: number,
  chunks: AsyncIterable<Uint8Array>,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  if (actualSize !== expectedSize) throw new Error('APK boyutu doğrulanamadı.');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error('APK özeti doğrulanamadı.');

  const hash = sha256.create();
  const magic: number[] = [];
  let bytesRead = 0;
  for await (const chunk of chunks) {
    if (magic.length < APK_MAGIC.length) {
      magic.push(...chunk.slice(0, APK_MAGIC.length - magic.length));
    }
    bytesRead += chunk.byteLength;
    hash.update(chunk);
  }

  if (bytesRead !== actualSize) throw new Error('APK boyutu doğrulanamadı.');
  if (!APK_MAGIC.every((byte, index) => magic[index] === byte)) {
    throw new Error('APK dosya imzası geçersiz.');
  }
  if (bytesToHex(hash.digest()) !== expectedSha256) {
    throw new Error('APK özeti doğrulanamadı.');
  }
}
