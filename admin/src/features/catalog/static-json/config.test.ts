import { describe, expect, it } from 'vitest';

import { getStaticCatalogConfig, hasStaticCatalogConfig } from './config';

function env(
  values: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return values;
}

const complete = {
  CATALOG_JSON_REPO: 'owner/repo',
  CATALOG_JSON_GITHUB_TOKEN: 'token',
};

describe('getStaticCatalogConfig', () => {
  it('returns null when the repository is missing', () => {
    expect(getStaticCatalogConfig(env({ CATALOG_JSON_GITHUB_TOKEN: 'token' }))).toBeNull();
  });

  it('returns null when the token is missing', () => {
    expect(getStaticCatalogConfig(env({ CATALOG_JSON_REPO: 'owner/repo' }))).toBeNull();
  });

  it('returns null for empty strings', () => {
    expect(
      getStaticCatalogConfig(env({ CATALOG_JSON_REPO: '', CATALOG_JSON_GITHUB_TOKEN: '  ' })),
    ).toBeNull();
  });

  it('returns null for an invalid repository', () => {
    expect(
      getStaticCatalogConfig(
        env({ CATALOG_JSON_REPO: 'not-a-repo', CATALOG_JSON_GITHUB_TOKEN: 'token' }),
      ),
    ).toBeNull();
  });

  it('defaults the branch and directory', () => {
    expect(getStaticCatalogConfig(env(complete))).toEqual({
      repo: 'owner/repo',
      branch: 'main',
      path: 'catalog',
      token: 'token',
    });
  });

  it('accepts a custom branch and directory', () => {
    expect(
      getStaticCatalogConfig(
        env({
          ...complete,
          CATALOG_JSON_BRANCH: 'release',
          CATALOG_JSON_PATH: 'public/catalog',
        }),
      ),
    ).toEqual({
      repo: 'owner/repo',
      branch: 'release',
      path: 'public/catalog',
      token: 'token',
    });
  });

  it('accepts an empty directory as the repository root', () => {
    expect(getStaticCatalogConfig(env({ ...complete, CATALOG_JSON_PATH: '' }))?.path).toBe('');
  });

  it('rejects a directory that climbs out of the repository', () => {
    expect(getStaticCatalogConfig(env({ ...complete, CATALOG_JSON_PATH: '../secrets' }))).toBeNull();
  });
});

describe('hasStaticCatalogConfig', () => {
  it('reports whether publishing can run', () => {
    expect(hasStaticCatalogConfig(env(complete))).toBe(true);
    expect(hasStaticCatalogConfig(env({ CATALOG_JSON_REPO: 'owner/repo' }))).toBe(false);
  });
});
