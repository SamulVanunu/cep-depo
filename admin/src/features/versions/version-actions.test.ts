import { describe, expect, it, vi } from 'vitest';

import { publishVersion, type PublishDependencies } from './version-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const versionId = 'a3000000-0000-4000-8000-000000000001';

function dependencies(overrides: Partial<PublishDependencies> = {}): PublishDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    getDraft: vi.fn(async () => ({
      id: versionId,
      appId,
      draftPath: 'operations/op/source.apk',
      canonicalPath: `apps/${appId}/versions/${versionId}.apk`,
      size: 1024,
    })),
    inspectCanonical: vi.fn(async () => ({ size: 1024 })),
    copyToCanonical: vi.fn(async () => undefined),
    publishRpc: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('publishVersion', () => {
it('reuses an existing canonical object after RPC failure and publishes only after verification', async () => {
  let canonicalExists = false;
  let rpcCalls = 0;
  const revalidate = vi.fn();
  const subject = dependencies({
    inspectCanonical: vi.fn(async () => canonicalExists ? { size: 1024 } : null),
    copyToCanonical: vi.fn(async () => { canonicalExists = true; }),
    publishRpc: vi.fn(async () => {
      rpcCalls += 1;
      return rpcCalls === 1 ? { error: new Error('temporary') } : { error: null };
    }),
    revalidate,
  });

  await expect(publishVersion(versionId, subject)).resolves.toMatchObject({
    ok: false,
    error: { code: 'TEMPORARY' },
  });
  expect(subject.copyToCanonical).toHaveBeenCalledOnce();
  expect(revalidate).not.toHaveBeenCalled();

  await expect(publishVersion(versionId, subject)).resolves.toEqual({
    ok: true,
    data: { status: 'published' },
  });
  expect(subject.copyToCanonical).toHaveBeenCalledOnce();
  expect(subject.publishRpc).toHaveBeenCalledTimes(2);
  expect(subject.publishRpc).toHaveBeenLastCalledWith(actorId, versionId, false);
  expect(revalidate).toHaveBeenCalledOnce();
  expect(revalidate).toHaveBeenCalledWith(appId);
});

it('selects atomic app activation only for a wizard-created app', async () => {
  const publishRpc = vi.fn(async () => ({ error: null }));
  const subject = dependencies({ publishRpc });

  await expect(publishVersion(versionId, subject, true)).resolves.toMatchObject({ ok: true });
  expect(publishRpc).toHaveBeenCalledWith(actorId, versionId, true);
});

it('rejects an invalid ID before reading or copying storage', async () => {
  const subject = dependencies();
  await expect(publishVersion('not-a-uuid', subject)).resolves.toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
  expect(subject.getDraft).not.toHaveBeenCalled();
  expect(subject.inspectCanonical).not.toHaveBeenCalled();
  expect(subject.copyToCanonical).not.toHaveBeenCalled();
  expect(subject.publishRpc).not.toHaveBeenCalled();
});

it('rejects a mismatched canonical object before publication', async () => {
  const subject = dependencies({ inspectCanonical: vi.fn(async () => ({ size: 2048 })) });
  await expect(publishVersion(versionId, subject)).resolves.toMatchObject({
    ok: false,
    error: { code: 'CONFLICT' },
  });
  expect(subject.copyToCanonical).not.toHaveBeenCalled();
  expect(subject.publishRpc).not.toHaveBeenCalled();
});
});
