import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

export const DOWNLOAD_HISTORY_KEY = 'cep-depo:download-history:v1';
export const INSTALLATION_ID_KEY = 'cep-depo:installation-id:v1';

export type DownloadHistory = Readonly<{
  schemaVersion: 1;
  apps: Readonly<Record<string, number>>;
}>;

export type DownloadStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const emptyHistory: DownloadHistory = Object.freeze({ schemaVersion: 1, apps: Object.freeze({}) });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function parseHistory(value: string | null): DownloadHistory | null {
  if (value === null) return emptyHistory;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPlainObject(parsed) || parsed.schemaVersion !== 1 || !isPlainObject(parsed.apps)) {
      return null;
    }
    const entries = Object.entries(parsed.apps);
    if (entries.some(([appId, version]) => appId.trim().length === 0 || !isPositiveInteger(version))) {
      return null;
    }
    return Object.freeze({ schemaVersion: 1, apps: Object.freeze(Object.fromEntries(entries) as Record<string, number>) });
  } catch {
    return null;
  }
}

export async function readDownloadHistory(
  storage: DownloadStorage = AsyncStorage,
): Promise<DownloadHistory> {
  const parsed = parseHistory(await storage.getItem(DOWNLOAD_HISTORY_KEY));
  if (parsed) return parsed;
  await storage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(emptyHistory));
  return emptyHistory;
}

export async function markVersionDownloaded(
  appId: string,
  versionCode: number,
  storage: DownloadStorage = AsyncStorage,
): Promise<void> {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId || !isPositiveInteger(versionCode)) {
    throw new Error('İndirme geçmişi girdisi geçersiz.');
  }
  const history = await readDownloadHistory(storage);
  const previous = history.apps[normalizedAppId];
  const nextVersion = previous ? Math.max(previous, versionCode) : versionCode;
  await storage.setItem(
    DOWNLOAD_HISTORY_KEY,
    JSON.stringify({ schemaVersion: 1, apps: { ...history.apps, [normalizedAppId]: nextVersion } }),
  );
}

export async function getOrCreateInstallationId(
  storage: DownloadStorage = AsyncStorage,
): Promise<string> {
  const stored = (await storage.getItem(INSTALLATION_ID_KEY))?.trim();
  if (stored && uuidPattern.test(stored)) return stored;
  const generated = Crypto.randomUUID();
  await storage.setItem(INSTALLATION_ID_KEY, generated);
  return generated;
}

export function getDownloadAction(
  latestCode: number,
  downloadedCode?: number,
): 'download' | 'update' {
  return downloadedCode !== undefined && latestCode > downloadedCode ? 'update' : 'download';
}
