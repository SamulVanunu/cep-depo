import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { AdminIdentity } from '../../../server/auth/require-admin';
import { publishStaticCatalogForAdmin } from './refresh';
import { StaticCatalogPublishError, type StaticCatalogGithubConfig } from './github';
import type { StaticCatalogBundle } from './types';

const identity = { userId: 'admin-1' } as unknown as AdminIdentity;
const config: StaticCatalogGithubConfig = {
  repo: 'owner/repo',
  branch: 'main',
  path: 'catalog',
  token: 'token',
};
const bundle = { files: [], skipped: [] } as unknown as StaticCatalogBundle;

function dependencies(
  overrides: Partial<{
    config: () => StaticCatalogGithubConfig | null;
    build: (identity: AdminIdentity) => Promise<StaticCatalogBundle>;
    publish: (bundle: StaticCatalogBundle, config: StaticCatalogGithubConfig) => Promise<unknown>;
  }> = {},
) {
  return {
    config: () => config,
    build: vi.fn(async () => bundle),
    publish: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe('publishStaticCatalogForAdmin', () => {
  it('stays silent when the feature is not configured', async () => {
    const deps = dependencies({ config: () => null });

    await expect(publishStaticCatalogForAdmin(identity, deps)).resolves.toBeNull();
    expect(deps.build).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('publishes the bundle built for the operator', async () => {
    const deps = dependencies();

    await expect(publishStaticCatalogForAdmin(identity, deps)).resolves.toBeNull();
    expect(deps.build).toHaveBeenCalledWith(identity);
    expect(deps.publish).toHaveBeenCalledWith(bundle, config);
  });

  it('maps a rejected token to FORBIDDEN', async () => {
    const deps = dependencies({
      publish: async () => {
        throw new StaticCatalogPublishError('bad token', 403);
      },
    });

    const error = await publishStaticCatalogForAdmin(identity, deps);

    expect(error?.code).toBe('FORBIDDEN');
  });

  it('maps a conflicting write to CONFLICT', async () => {
    const deps = dependencies({
      publish: async () => {
        throw new StaticCatalogPublishError('conflict', 409);
      },
    });

    const error = await publishStaticCatalogForAdmin(identity, deps);

    expect(error?.code).toBe('CONFLICT');
  });

  it('maps an unknown repository to VALIDATION', async () => {
    const deps = dependencies({
      publish: async () => {
        throw new StaticCatalogPublishError('missing repo', 404);
      },
    });

    const error = await publishStaticCatalogForAdmin(identity, deps);

    expect(error?.code).toBe('VALIDATION');
  });

  it('maps a GitHub server failure to TEMPORARY', async () => {
    const deps = dependencies({
      publish: async () => {
        throw new StaticCatalogPublishError('github down', 500);
      },
    });

    const error = await publishStaticCatalogForAdmin(identity, deps);

    expect(error?.code).toBe('TEMPORARY');
  });

  it('maps an unexpected failure to INTERNAL', async () => {
    const deps = dependencies({
      build: async () => {
        throw new Error('boom');
      },
    });

    const error = await publishStaticCatalogForAdmin(identity, deps);

    expect(error?.code).toBe('INTERNAL');
  });
});
