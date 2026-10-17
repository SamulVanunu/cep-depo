import { describe, expect, it } from 'vitest';

import {
  APK_MAX_BYTES,
  HOSTED_STORAGE_MAX_BYTES,
  apkDraftInputSchema,
  externalDraftInputSchema,
  storageDraftInputSchema,
} from './upload-schema';

const appId = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a3000000-0000-4000-8000-000000000001';

const common = {
  appId,
  packageName: 'com.example.release',
  versionName: ' 1.2.0 ',
  versionCode: 2_147_483_647,
  changelog: 'Release',
  size: 1024,
  sha256: 'a'.repeat(64),
};

describe('APK draft schemas', () => {
  it('parses manifest identity for a Storage draft', () => {
    expect(storageDraftInputSchema.parse({
      ...common,
      source: 'storage',
      operationId,
    })).toEqual({
      ...common,
      source: 'storage',
      operationId,
      versionName: '1.2.0',
    });
  });

  it('parses manifest identity for an external draft without weakening its URL fields', () => {
    expect(externalDraftInputSchema.parse({
      ...common,
      source: 'external',
      fileName: 'release.apk',
      apkUrl: 'https://downloads.example.com/releases/release.apk',
      size: 50_000_001,
    })).toMatchObject({
      source: 'external',
      packageName: 'com.example.release',
      versionName: '1.2.0',
      versionCode: 2_147_483_647,
      fileName: 'release.apk',
      apkUrl: 'https://downloads.example.com/releases/release.apk',
    });
  });

  it.each([
    ['missing package name', { packageName: undefined }],
    ['one package segment', { packageName: 'release' }],
    ['surrounding package whitespace', { packageName: ' com.example.release ' }],
    ['invalid package segment', { packageName: 'com.example.release-name' }],
    ['empty trimmed version name', { versionName: '   ' }],
    ['long version name', { versionName: 'v'.repeat(41) }],
    ['zero version code', { versionCode: 0 }],
    ['fractional version code', { versionCode: 1.5 }],
    ['PostgreSQL-overflowing version code', { versionCode: 2_147_483_648 }],
  ])('rejects %s for both draft sources', (_name, patch) => {
    expect(storageDraftInputSchema.safeParse({
      ...common,
      source: 'storage',
      operationId,
      ...patch,
    }).success).toBe(false);
    expect(externalDraftInputSchema.safeParse({
      ...common,
      source: 'external',
      fileName: 'release.apk',
      apkUrl: 'https://downloads.example.com/release.apk',
      ...patch,
    }).success).toBe(false);
  });

  it('keeps the source contract as a discriminated union', () => {
    expect(apkDraftInputSchema.safeParse({
      ...common,
      source: 'storage',
      operationId,
      apkUrl: 'https://downloads.example.com/release.apk',
    }).success).toBe(false);
    expect(apkDraftInputSchema.safeParse({
      ...common,
      source: 'external',
      operationId,
      fileName: 'release.apk',
      apkUrl: 'https://downloads.example.com/release.apk',
    }).success).toBe(false);
  });

  it('preserves the exact routing threshold and APK size limit', () => {
    expect(HOSTED_STORAGE_MAX_BYTES).toBe(50_000_000);
    expect(APK_MAX_BYTES).toBe(524_288_000);
  });
});
