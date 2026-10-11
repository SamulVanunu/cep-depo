'use client';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

export async function hashFile(file: File, onProgress: (progress: number) => void = () => {}) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
    const chunk = new Uint8Array(await file.slice(offset, offset + HASH_CHUNK_BYTES).arrayBuffer());
    hash.update(chunk);
    onProgress(Math.min(1, (offset + chunk.byteLength) / file.size));
  }
  return bytesToHex(hash.digest());
}
