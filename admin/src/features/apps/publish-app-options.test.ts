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
        package_name: 'com.example.bir',
        app_versions: [
          { version_code: 3, status: 'published', supports_mobile: true, supports_tv: false, account_requirement: 'none' },
          { version_code: 9, status: 'draft', supports_mobile: true, supports_tv: true, account_requirement: 'required' },
          { version_code: 4, status: 'published', supports_mobile: false, supports_tv: true, account_requirement: 'optional' },
        ],
      },
      {
        id: 'a1000000-0000-4000-8000-000000000002',
        title: 'Sürümsüz',
        slug: 'surumsuz',
        status: 'archived',
        icon_path: null,
        package_name: null,
        app_versions: [],
      },
    ])).toEqual([
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        title: 'Bir Uygulama',
        slug: 'bir-uygulama',
        status: 'active',
        iconPath: 'apps/a100/icon.png',
        packageName: 'com.example.bir',
        latestVersionCode: 9,
        latestReleaseMetadata: {
          supportsMobile: false,
          supportsTv: true,
          accountRequirement: 'optional',
        },
      },
      {
        id: 'a1000000-0000-4000-8000-000000000002',
        title: 'Sürümsüz',
        slug: 'surumsuz',
        status: 'archived',
        iconPath: null,
        packageName: null,
        latestVersionCode: null,
        latestReleaseMetadata: null,
      },
    ]);
  });
});
