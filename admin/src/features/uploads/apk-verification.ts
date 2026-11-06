import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { ActionException } from '../../server/errors/action-error';
import {
  parseApkManifestFromSource,
  type ApkByteSource,
  type ParsedApkManifest,
} from './apk-manifest';

/** Bounded read size for the streaming digest (matches the browser hasher). */
export const APK_HASH_CHUNK_BYTES = 4 * 1024 * 1024;

export type VerifiedApk = Readonly<{
  manifest: ParsedApkManifest;
  sha256: string;
}>;

export type DeclaredApkIdentity = Readonly<{
  packageName: string;
  versionName: string;
  versionCode: number;
  sha256: string;
}>;

/**
 * Parses the real APK bytes and recomputes the SHA-256 in bounded chunks.
 *
 * The manifest parser has its own caps; the hash pass never holds more than
 * `APK_HASH_CHUNK_BYTES` at once. A short read means the object was smaller
 * than its declared size, which is a temporary storage failure, not an
 * invalid APK.
 */
export async function verifyApkBytes(source: ApkByteSource): Promise<VerifiedApk> {
  if (!Number.isInteger(source.size) || source.size <= 0) {
    throw new ActionException('VALIDATION');
  }

  let manifest: ParsedApkManifest;
  try {
    manifest = await parseApkManifestFromSource(source);
  } catch (error) {
    if (error instanceof ActionException) throw error;
    throw new ActionException('VALIDATION');
  }

  const hash = sha256.create();
  for (let offset = 0; offset < source.size; offset += APK_HASH_CHUNK_BYTES) {
    const end = Math.min(offset + APK_HASH_CHUNK_BYTES, source.size);
    const chunk = await source.read(offset, end);
    if (chunk.length !== end - offset) throw new ActionException('TEMPORARY');
    hash.update(chunk);
  }

  return Object.freeze({ manifest, sha256: bytesToHex(hash.digest()) });
}

/**
 * Compares the client-declared APK identity with the values read from the
 * file. Any mismatch is a validation failure with one generic message, so the
 * response does not tell the caller which field to forge next.
 */
export function assertDeclaredApkMatches(
  verified: VerifiedApk,
  declared: DeclaredApkIdentity,
): void {
  const { manifest, sha256: digest } = verified;
  if (
    manifest.packageName !== declared.packageName ||
    manifest.versionName !== declared.versionName ||
    manifest.versionCode !== declared.versionCode ||
    digest !== declared.sha256
  ) {
    throw new ActionException('VALIDATION');
  }
}
