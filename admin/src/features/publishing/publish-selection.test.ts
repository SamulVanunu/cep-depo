import { describe, expect, it } from 'vitest';

import type { PublishAppOption } from '../apps/app-dal';
import { resolvePreselectedApp } from './publish-selection';

const apps: readonly PublishAppOption[] = [
  {
    id: 'a1000000-0000-4000-8000-000000000001',
    title: 'Cep Araç',
    slug: 'cep-arac',
    status: 'active',
    iconPath: null,
    latestVersionCode: 7,
  },
];

describe('publish selection', () => {
  it('does not treat a missing query as invalid', () => {
    expect(resolvePreselectedApp(undefined, apps)).toEqual({ app: null, invalid: false });
  });

  it('preselects only a listed UUID', () => {
    expect(resolvePreselectedApp(apps[0]!.id, apps)).toEqual({ app: apps[0], invalid: false });
    expect(resolvePreselectedApp('not-a-uuid', apps)).toEqual({ app: null, invalid: true });
    expect(resolvePreselectedApp('a1000000-0000-4000-8000-000000000099', apps)).toEqual({
      app: null,
      invalid: true,
    });
  });
});
