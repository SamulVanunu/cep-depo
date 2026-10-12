import { z } from 'zod';

import type { PublishAppOption } from '../apps/publish-app-options';

export function resolvePreselectedApp(
  rawAppId: string | undefined,
  apps: readonly PublishAppOption[],
): Readonly<{ app: PublishAppOption | null; invalid: boolean }> {
  if (rawAppId === undefined) return { app: null, invalid: false };
  if (!z.string().uuid().safeParse(rawAppId).success) return { app: null, invalid: true };
  return {
    app: apps.find(app => app.id === rawAppId) ?? null,
    invalid: !apps.some(app => app.id === rawAppId),
  };
}
