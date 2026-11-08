import type { StaticCatalogBundle } from './types';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;

export type StaticCatalogGithubConfig = Readonly<{
  token: string;
  /** `owner/name` */
  repo: string;
  branch: string;
  /** Repository directory that holds the JSON files; empty means the root. */
  path: string;
}>;

export type StaticCatalogPublishResult = Readonly<{
  commitSha: string;
  commitUrl: string;
  fileCount: number;
  deletedPaths: readonly string[];
}>;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class StaticCatalogPublishError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'StaticCatalogPublishError';
    this.status = status;
  }
}

function normalizePrefix(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (trimmed.length === 0) return '';
  if (
    trimmed.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..') ||
    trimmed.includes('\\') ||
    trimmed.includes('%')
  ) {
    throw new StaticCatalogPublishError('Geçersiz katalog klasörü.', 400);
  }
  return trimmed;
}

function validateConfig(config: StaticCatalogGithubConfig): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repo)) {
    throw new StaticCatalogPublishError('Geçersiz GitHub deposu.', 400);
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(config.branch) || config.branch.startsWith('/') || config.branch.endsWith('/')) {
    throw new StaticCatalogPublishError('Geçersiz GitHub dalı.', 400);
  }
  if (config.token.trim().length === 0) {
    throw new StaticCatalogPublishError('GitHub token’ı tanımlı değil.', 400);
  }
}

function joinPath(prefix: string, path: string): string {
  return prefix.length > 0 ? `${prefix}/${path}` : path;
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new StaticCatalogPublishError('GitHub yanıtı okunamadı.', response.status);
  }
}

async function request<T>(
  fetchImpl: FetchLike,
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  body?: unknown,
  allowNotFound = false,
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StaticCatalogPublishError('GitHub’a ulaşılamadı.');
  }

  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    const payload = await readJson<{ message?: string }>(response).catch(() => null);
    const message = payload?.message?.trim() || `GitHub isteği başarısız (${response.status}).`;
    throw new StaticCatalogPublishError(message, response.status);
  }
  return readJson<T>(response);
}

/**
 * Publishes the whole document set as one commit through the Git Data API.
 * App files that were published before but no longer exist are removed in the
 * same tree, so a deleted app cannot linger in the repository.
 */
export async function publishStaticCatalog(
  bundle: StaticCatalogBundle,
  config: StaticCatalogGithubConfig,
  fetchImpl: FetchLike = fetch,
): Promise<StaticCatalogPublishResult> {
  validateConfig(config);
  const prefix = normalizePrefix(config.path);
  const repoApi = `${GITHUB_API}/repos/${config.repo}`;

  const ref = await request<{ object: { sha: string } }>(
    fetchImpl,
    config.token,
    'GET',
    `${repoApi}/git/ref/heads/${config.branch}`,
  );
  if (!ref?.object?.sha) throw new StaticCatalogPublishError('GitHub dalı bulunamadı.', 404);

  const head = await request<{ tree: { sha: string } }>(
    fetchImpl,
    config.token,
    'GET',
    `${repoApi}/git/commits/${ref.object.sha}`,
  );
  if (!head?.tree?.sha) throw new StaticCatalogPublishError('GitHub commit’i okunamadı.', 404);

  const wanted = new Set(bundle.files.map(file => file.path));
  const listing = await request<readonly { type: string; name: string; path: string }[]>(
    fetchImpl,
    config.token,
    'GET',
    `${repoApi}/contents/${joinPath(prefix, 'apps')}?ref=${encodeURIComponent(config.branch)}`,
    undefined,
    true,
  );
  const deletedPaths = (listing ?? [])
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.json'))
    .filter(entry => !wanted.has(`apps/${entry.name}`))
    .map(entry => joinPath(prefix, entry.path));

  const treeEntries: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
  for (const file of bundle.files) {
    const blob = await request<{ sha: string }>(
      fetchImpl,
      config.token,
      'POST',
      `${repoApi}/git/blobs`,
      { content: Buffer.from(file.content, 'utf8').toString('base64'), encoding: 'base64' },
    );
    if (!blob?.sha) throw new StaticCatalogPublishError('GitHub blob’u oluşturulamadı.');
    treeEntries.push({ path: joinPath(prefix, file.path), mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const path of deletedPaths) {
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
  }

  const tree = await request<{ sha: string }>(
    fetchImpl,
    config.token,
    'POST',
    `${repoApi}/git/trees`,
    { base_tree: head.tree.sha, tree: treeEntries },
  );
  if (!tree?.sha) throw new StaticCatalogPublishError('GitHub ağacı oluşturulamadı.');

  const commit = await request<{ sha: string }>(
    fetchImpl,
    config.token,
    'POST',
    `${repoApi}/git/commits`,
    {
      message: `catalog: publish static JSON (${bundle.generatedAt})`,
      tree: tree.sha,
      parents: [ref.object.sha],
    },
  );
  if (!commit?.sha) throw new StaticCatalogPublishError('GitHub commit’i oluşturulamadı.');

  await request(
    fetchImpl,
    config.token,
    'PATCH',
    `${repoApi}/git/refs/heads/${config.branch}`,
    { sha: commit.sha, force: false },
  );

  return Object.freeze({
    commitSha: commit.sha,
    commitUrl: `https://github.com/${config.repo}/commit/${commit.sha}`,
    fileCount: bundle.files.length,
    deletedPaths: Object.freeze(deletedPaths),
  });
}
