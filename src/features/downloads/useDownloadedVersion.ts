import { useCallback, useEffect, useState } from 'react';

import { readDownloadHistory } from './download-history';

export function useDownloadedVersion(appId: string | null) {
  const [downloadedVersion, setDownloadedVersion] = useState<number | undefined>();

  const refresh = useCallback(async () => {
    if (!appId) {
      setDownloadedVersion(undefined);
      return;
    }
    const history = await readDownloadHistory();
    setDownloadedVersion(history.apps[appId]);
  }, [appId]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!appId) {
        if (active) setDownloadedVersion(undefined);
        return;
      }
      const history = await readDownloadHistory();
      if (active) setDownloadedVersion(history.apps[appId]);
    }
    void load();
    return () => {
      active = false;
    };
  }, [appId]);

  return { downloadedVersion, refresh } as const;
}
