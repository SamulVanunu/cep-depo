import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { ApkDownloadError } from './apk-error';

const APK_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export async function verifyApkChunks(
  actualSize: number,
  chunks: AsyncIterable<Uint8Array>,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  if (actualSize !== expectedSize) throw new ApkDownloadError('size');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new ApkDownloadError('sha256');

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

  if (bytesRead !== actualSize) throw new ApkDownloadError('size');
  if (!APK_MAGIC.every((byte, index) => magic[index] === byte)) {
    throw new ApkDownloadError('magic');
  }
  if (bytesToHex(hash.digest()) !== expectedSha256) {
    throw new ApkDownloadError('sha256');
  }
}
