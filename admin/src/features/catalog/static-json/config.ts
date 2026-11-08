import { z } from 'zod';

import type { StaticCatalogGithubConfig } from './github';

export type StaticCatalogEnvSource = Readonly<Record<string, string | undefined>>;

const optionalText = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const staticCatalogSchema = z.object({
  repo: z.preprocess(
    value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .optional(),
  ),
  branch: z.string().trim().min(1).default('main'),
  path: z
    .string()
    .trim()
    .refine(
      value =>
        value === '' ||
        (/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(value) && !value.split('/').includes('..')),
      { message: 'Geçersiz klasör' },
    )
    .default('catalog'),
  token: optionalText,
});

/** Static catalog publishing config; null when disabled or invalid. */
export function getStaticCatalogConfig(
  source: StaticCatalogEnvSource = process.env,
): StaticCatalogGithubConfig | null {
  const parsed = staticCatalogSchema.safeParse({
    repo: source.CATALOG_JSON_REPO,
    branch: source.CATALOG_JSON_BRANCH,
    path: source.CATALOG_JSON_PATH,
    token: source.CATALOG_JSON_GITHUB_TOKEN,
  });
  if (!parsed.success) return null;
  const { repo, branch, path, token } = parsed.data;
  if (!repo || !token) return null;
  return { repo, branch, path, token };
}

export function hasStaticCatalogConfig(
  source: StaticCatalogEnvSource = process.env,
): boolean {
  return getStaticCatalogConfig(source) !== null;
}
