import { expect, it, vi } from 'vitest';

import { publishVersion, type PublishDependencies } from './version-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const versionId = 'a3000000-0000-4000-8000-000000000001';

it('reuses an existing canonical object after RPC failure and publishes only after verification', async () => {
  let canonicalExists = false;
  let rpcCalls = 0;
  const dependencies: PublishDependencies = {
    authorize: vi.fn(async () => ({ userId: actorId })),
    getDraft: vi.fn(async () => ({
      id: versionId,
      appId,
      draftPath: 'operations/op/source.apk',
      canonicalPath: `apps/${appId}/versions/${versionId}.apk`,
      size: 1024,
    })),
    inspectCanonical: vi.fn(async () => canonicalExists ? { size: 1024 } : null),
    copyToCanonical: vi.fn(async () => { canonicalExists = true; }),
    publishRpc: vi.fn(async () => {
      rpcCalls += 1;
      return rpcCalls === 1 ? { error: new Error('temporary') } : { error: null };
    }),
  };

  await expect(publishVersion(versionId, dependencies)).resolves.toMatchObject({
    ok: false,
    error: { code: 'TEMPORARY' },
  });
  expect(dependencies.copyToCanonical).toHaveBeenCalledOnce();

  await expect(publishVersion(versionId, dependencies)).resolves.toEqual({
    ok: true,
    data: { status: 'published' },
  });
  expect(dependencies.copyToCanonical).toHaveBeenCalledOnce();
  expect(dependencies.publishRpc).toHaveBeenCalledTimes(2);
});
