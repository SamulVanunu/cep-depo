// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { publishStaticCatalog, StaticCatalogPublishError } from './github';
import type { StaticCatalogBundle } from './types';

const bundle: StaticCatalogBundle = {
  generatedAt: '2026-11-07T12:00:00.000Z',
  appCount: 1,
  categoryCount: 1,
  skipped: [],
  files: [
    { path: 'homescreen.json', content: '{"schemaVersion":1}' },
    { path: 'apps/ornek.json', content: '{"schemaVersion":1}' },
    { path: 'manifest.json', content: '{"schemaVersion":1}' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFetch(calls: { url: string; method: string; body: unknown }[]) {
  let blob = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });

    if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'head-sha' } });
    if (url.endsWith('/git/commits/head-sha')) return jsonResponse({ tree: { sha: 'base-tree' } });
    if (url.includes('/contents/catalog/apps')) {
      return jsonResponse([
        { type: 'file', name: 'ornek.json', path: 'ornek.json' },
        { type: 'file', name: 'eski.json', path: 'eski.json' },
        { type: 'dir', name: 'nested', path: 'nested' },
      ]);
    }
    if (url.endsWith('/git/blobs')) {
      blob += 1;
      return jsonResponse({ sha: `blob-${blob}` });
    }
    if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'new-tree' });
    if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'commit-1' });
    if (url.endsWith('/git/refs/heads/main')) return jsonResponse({ object: { sha: 'commit-1' } });
    return jsonResponse({ message: 'unexpected' }, 500);
  });
}

describe('publishStaticCatalog', () => {
  it('creates one commit with every file and deletes stale app files', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const result = await publishStaticCatalog(
      bundle,
      { token: 'token', repo: 'owner/repo', branch: 'main', path: 'catalog' },
      createFetch(calls),
    );

    expect(result).toEqual({
      commitSha: 'commit-1',
      commitUrl: 'https://github.com/owner/repo/commit/commit-1',
      fileCount: 3,
      deletedPaths: ['catalog/eski.json'],
    });

    const treeCall = calls.find(call => call.url.endsWith('/git/trees'));
    expect(treeCall?.body).toEqual({
      base_tree: 'base-tree',
      tree: [
        { path: 'catalog/homescreen.json', mode: '100644', type: 'blob', sha: 'blob-1' },
        { path: 'catalog/apps/ornek.json', mode: '100644', type: 'blob', sha: 'blob-2' },
        { path: 'catalog/manifest.json', mode: '100644', type: 'blob', sha: 'blob-3' },
        { path: 'catalog/eski.json', mode: '100644', type: 'blob', sha: null },
      ],
    });
  });

  it('keeps working when the apps directory does not exist yet', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/contents/')) return jsonResponse({ message: 'Not Found' }, 404);
      if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'head-sha' } });
      if (url.endsWith('/git/commits/head-sha')) return jsonResponse({ tree: { sha: 'base-tree' } });
      if (url.endsWith('/git/blobs')) return jsonResponse({ sha: 'blob' });
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'new-tree' });
      if (url.endsWith('/git/commits') && method === 'POST') return jsonResponse({ sha: 'commit-1' });
      if (url.endsWith('/git/refs/heads/main')) return jsonResponse({ object: { sha: 'commit-1' } });
      return jsonResponse({ message: 'unexpected' }, 500);
    });

    const result = await publishStaticCatalog(
      bundle,
      { token: 'token', repo: 'owner/repo', branch: 'main', path: 'catalog' },
      fetchImpl,
    );
    expect(result.deletedPaths).toEqual([]);
  });

  it('rejects an incomplete configuration before calling GitHub', async () => {
    const fetchImpl = vi.fn();
    await expect(
      publishStaticCatalog(bundle, { token: '', repo: 'owner/repo', branch: 'main', path: 'catalog' }, fetchImpl),
    ).rejects.toBeInstanceOf(StaticCatalogPublishError);
    await expect(
      publishStaticCatalog(bundle, { token: 'token', repo: 'bad repo', branch: 'main', path: 'catalog' }, fetchImpl),
    ).rejects.toThrow('GitHub deposu');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces the GitHub error message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Resource not accessible by integration' }, 403));
    await expect(
      publishStaticCatalog(
        bundle,
        { token: 'token', repo: 'owner/repo', branch: 'main', path: 'catalog' },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ status: 403, message: 'Resource not accessible by integration' });
  });
});
