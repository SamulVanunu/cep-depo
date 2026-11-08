'use server';

import { requireAdmin } from '../../server/auth/require-admin';
import { createCatalogRefreshAction } from './catalog-json';

/**
 * Re-runs the full catalog refresh — the DB-backed Storage release and the
 * static JSON mirror — for the signed-in admin. Used when a publication
 * succeeded but its catalog warning needs another attempt.
 */
export async function refreshCatalogAction() {
  return createCatalogRefreshAction(requireAdmin)();
}
