import type { AdminIdentity } from '../../../server/auth/require-admin';
import type { ActionError, ActionErrorCode } from '../../../server/errors/action-error';
import { ActionException, toActionError } from '../../../server/errors/action-error';
import { getStaticCatalogConfig } from './config';
import { buildStaticCatalogForAdmin } from './dal';
import {
  publishStaticCatalog,
  StaticCatalogPublishError,
  type StaticCatalogGithubConfig,
} from './github';
import type { StaticCatalogBundle } from './types';

export function staticCatalogErrorCode(status: number): ActionErrorCode {
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status === 409 || status === 422) return 'CONFLICT';
  if (status === 400 || status === 404) return 'VALIDATION';
  return 'TEMPORARY';
}

export type StaticCatalogRefreshDependencies = Readonly<{
  config(): StaticCatalogGithubConfig | null;
  build(identity: AdminIdentity): Promise<StaticCatalogBundle>;
  publish(bundle: StaticCatalogBundle, config: StaticCatalogGithubConfig): Promise<unknown>;
}>;

export function defaultStaticCatalogRefreshDependencies(): StaticCatalogRefreshDependencies {
  return {
    config: () => getStaticCatalogConfig(),
    build: identity => buildStaticCatalogForAdmin(identity),
    publish: (bundle, config) => publishStaticCatalog(bundle, config),
  };
}

/**
 * Publishes the static JSON set when the feature is configured. Returns null on
 * success or when disabled; a failure becomes an ActionError the caller turns
 * into a catalog warning — it must never roll back a version publication.
 */
export async function publishStaticCatalogForAdmin(
  identity: AdminIdentity,
  dependencies: StaticCatalogRefreshDependencies = defaultStaticCatalogRefreshDependencies(),
): Promise<ActionError | null> {
  const config = dependencies.config();
  if (!config) return null;
  try {
    const bundle = await dependencies.build(identity);
    await dependencies.publish(bundle, config);
    return null;
  } catch (error) {
    if (error instanceof StaticCatalogPublishError) {
      return toActionError(new ActionException(staticCatalogErrorCode(error.status)));
    }
    return toActionError(error);
  }
}
