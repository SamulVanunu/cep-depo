import { describe, expect, it } from 'vitest';

import { mapPublishAppOptions } from './publish-app-options';

describe('publish app options', () => {
  it('maps only publishing fields and derives the highest version code', () => {
    expect(mapPublishAppOptions([
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        title: 'Bir Uygulama',
        slug: 'bir-uygulama',
        status: 'active',
        icon_path: 'apps/a100/icon.png',
        app_versions: [{ version_code: 3 }, { version_code: 9 }, { version_code: 4 }],
      },
      {
        id: 'a1000000-0000-4000-8000-000000000002',
        title: 'Sürümsüz',
        slug: 'surumsuz',
        status: 'archived',
        icon_path: null,
        app_versions: [],
      },
    ])).toEqual([
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        title: 'Bir Uygulama',
        slug: 'bir-uygulama',
        status: 'active',
        iconPath: 'apps/a100/icon.png',
        latestVersionCode: 9,
      },
      {
        id: 'a1000000-0000-4000-8000-000000000002',
        title: 'Sürümsüz',
        slug: 'surumsuz',
        status: 'archived',
        iconPath: null,
        latestVersionCode: null,
      },
    ]);
  });
});
