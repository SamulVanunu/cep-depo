import { describe, expect, it, vi } from 'vitest';

import { hashFile } from './hash-file';

describe('hashFile', () => {
  it('stops between chunks when hashing is cancelled', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn<(progress: number) => void>(() => controller.abort());
    const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'release.apk');

    await expect(hashFile(file, onProgress, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(expect.any(Number));
    expect(onProgress.mock.calls[0]![0]).toBeLessThan(1);
  });
});
