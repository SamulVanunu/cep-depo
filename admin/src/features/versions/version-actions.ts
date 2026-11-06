'use server';

import {
  defaultReplaceVersionDependencies,
  defaultWithdrawDependencies,
  publishVersionReplacingPrevious,
  withdrawVersion,
} from './version-service';

/**
 * Every export of this module is a callable server action. Keep it to the two
 * supported transitions: replacement publication is the only way a version may
 * become `published`, and withdrawal is the only way it leaves that state.
 * Service helpers belong in `version-service.ts`, which exposes no actions.
 */
export async function publishVersionReplacingPreviousAction(
  versionId: string,
  catalogOperationId?: string,
) {
  return publishVersionReplacingPrevious(
    versionId,
    defaultReplaceVersionDependencies(),
    catalogOperationId,
  );
}

export async function withdrawVersionAction(versionId: string, catalogOperationId?: string) {
  return withdrawVersion(versionId, defaultWithdrawDependencies(), catalogOperationId);
}
