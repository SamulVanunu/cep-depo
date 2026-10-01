import * as Linking from 'expo-linking';

import { createCatalogRepository } from '../catalog/catalog.repository';
import { getPublicApkUrl, getSupabaseClient } from '../../lib/supabase';
import { getOrCreateInstallationId, markVersionDownloaded } from './download-history';

export type DownloadInput = Readonly<{
  appId: string;
  versionId: string;
  versionCode: number;
  apkPath: string;
}>;

export type DownloadDependencies = Readonly<{
  resolveApkUrl(path: string): string;
  openUrl(url: string): Promise<unknown>;
  markVersionDownloaded(appId: string, versionCode: number): Promise<void>;
  getInstallationId(): Promise<string>;
  recordDownload(versionId: string, installationId: string): Promise<boolean>;
  warn(message: string): void;
}>;

export const defaultDownloadDependencies: DownloadDependencies = {
  resolveApkUrl: getPublicApkUrl,
  openUrl: Linking.openURL,
  markVersionDownloaded,
  getInstallationId: getOrCreateInstallationId,
  recordDownload: (versionId, installationId) =>
    createCatalogRepository(getSupabaseClient()).recordDownload(versionId, installationId),
  warn: message => console.warn(message),
};

function requireSecureUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error('Güvenli APK adresi oluşturulamadı.');
  }
}

export async function openApkDownload(
  input: DownloadInput,
  dependencies: DownloadDependencies,
): Promise<{ metricsRecorded: boolean }> {
  const url = requireSecureUrl(dependencies.resolveApkUrl(input.apkPath));
  await dependencies.openUrl(url);
  await dependencies.markVersionDownloaded(input.appId, input.versionCode);

  try {
    const installationId = await dependencies.getInstallationId();
    const metricsRecorded = await dependencies.recordDownload(input.versionId, installationId);
    return { metricsRecorded };
  } catch {
    dependencies.warn('İndirme metriği kaydedilemedi.');
    return { metricsRecorded: false };
  }
}
