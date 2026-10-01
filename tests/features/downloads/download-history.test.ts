import * as Crypto from 'expo-crypto';

import {
  DOWNLOAD_HISTORY_KEY,
  INSTALLATION_ID_KEY,
  getDownloadAction,
  getOrCreateInstallationId,
  markVersionDownloaded,
  readDownloadHistory,
} from '../../../src/features/downloads/download-history';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
}

describe('download history', () => {
  it.each(['{bad json', '[]', '{"schemaVersion":99}', '{"schemaVersion":1,"apps":{"app":0}}']) (
    'resets malformed or unsupported history without throwing: %s',
    async stored => {
      const storage = memoryStorage({ [DOWNLOAD_HISTORY_KEY]: stored });

      await expect(readDownloadHistory(storage)).resolves.toEqual({ schemaVersion: 1, apps: {} });
      expect(storage.values.get(DOWNLOAD_HISTORY_KEY)).toBe('{"schemaVersion":1,"apps":{}}');
    },
  );

  it('persists the highest locally opened version for an app', async () => {
    const storage = memoryStorage();

    await markVersionDownloaded('app-1', 12, storage);
    await markVersionDownloaded('app-1', 10, storage);

    await expect(readDownloadHistory(storage)).resolves.toEqual({
      schemaVersion: 1,
      apps: { 'app-1': 12 },
    });
  });

  it('returns update only when latest version code is greater than locally opened code', () => {
    expect(getDownloadAction(12, 11)).toBe('update');
    expect(getDownloadAction(12, 12)).toBe('download');
    expect(getDownloadAction(12)).toBe('download');
  });

  it('reuses a valid installation UUID and replaces an invalid one securely', async () => {
    const generated = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    jest.mocked(Crypto.randomUUID).mockReturnValue(generated);
    const validStorage = memoryStorage({ [INSTALLATION_ID_KEY]: generated });
    const invalidStorage = memoryStorage({ [INSTALLATION_ID_KEY]: 'not-a-uuid' });

    await expect(getOrCreateInstallationId(validStorage)).resolves.toBe(generated);
    expect(Crypto.randomUUID).not.toHaveBeenCalled();

    await expect(getOrCreateInstallationId(invalidStorage)).resolves.toBe(generated);
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(invalidStorage.values.get(INSTALLATION_ID_KEY)).toBe(generated);
  });
});
