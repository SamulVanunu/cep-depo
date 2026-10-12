import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import { getPublicApkUrl, getSupabaseClient } from '../../lib/supabase';
import { createCatalogRepository } from '../catalog/catalog.repository';
import type { ApkDownloadDependencies, ApkDownloadInput, DownloadedApk } from './apk-download';
import { getOrCreateInstallationId, markVersionDownloaded } from './download-history';
import { verifyApkChunks } from './verify-apk';

const APK_MIME = 'application/vnd.android.package-archive';
const ACTION_VIEW = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;
const HASH_CHUNK_BYTES = 1024 * 1024;

export function installerIntentParams(contentUri: string) {
  if (!contentUri.startsWith('content://')) throw new Error('APK installer adresi oluşturulamadı.');
  return {
    data: contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
  } as const;
}

async function* readFileChunks(file: File): AsyncGenerator<Uint8Array> {
  const handle = file.open(FileMode.ReadOnly);
  try {
    let remaining = file.size;
    while (remaining > 0) {
      const chunk = handle.readBytes(Math.min(HASH_CHUNK_BYTES, remaining));
      if (!chunk.byteLength) throw new Error('APK boyutu doğrulanamadı.');
      remaining -= chunk.byteLength;
      yield chunk;
    }
  } finally {
    handle.close();
  }
}

function destinationFile(input: ApkDownloadInput): File {
  const directory = new Directory(Paths.cache, 'apk-downloads');
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, `${input.versionId}.apk`);
}

export const defaultApkDownloadDependencies: ApkDownloadDependencies = {
  resolveApkUrl: getPublicApkUrl,
  async prepareDestination(input) {
    const file = destinationFile(input);
    if (file.exists) file.delete();
    return file.uri;
  },
  createTask(url, destination, onProgress) {
    const task = File.createDownloadTask(url, new File(destination), { onProgress });
    return {
      cancel: () => task.cancel(),
      async download(): Promise<DownloadedApk | null> {
        const file = await task.downloadAsync();
        return file ? { uri: file.uri, size: file.size } : null;
      },
      release: () => task.release(),
    };
  },
  async verifyApk(downloaded, expected) {
    const file = new File(downloaded.uri);
    await verifyApkChunks(file.size, readFileChunks(file), expected.size, expected.sha256);
  },
  async removeFile(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  async openInstaller(downloaded) {
    if (Platform.OS !== 'android') throw new Error('APK kurulumu yalnız Android cihazlarda desteklenir.');
    const file = new File(downloaded.uri);
    await IntentLauncher.startActivityAsync(ACTION_VIEW, installerIntentParams(file.contentUri));
  },
  markVersionDownloaded,
  getInstallationId: getOrCreateInstallationId,
  recordDownload: (versionId, installationId) =>
    createCatalogRepository(getSupabaseClient()).recordDownload(versionId, installationId),
  warn: message => console.warn(message),
};
