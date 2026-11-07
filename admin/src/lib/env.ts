import { z } from 'zod';

type EnvSource = Readonly<Record<string, string | undefined>>;

export type PublicEnv = Readonly<{
  supabaseUrl: string;
  supabasePublishableKey: string;
}>;

export type ServerEnv = PublicEnv &
  Readonly<{
    siteUrl: string;
    supabaseSecretKey: string;
    adminReadOnly: boolean;
    authEmailEnabled: boolean;
    externalApkPublishingEnabled: boolean;
    cleanupWorkerSecret: string | null;
    cronSecret: string | null;
    /** Server-only GitHub token with Actions: write and Contents: read. */
    githubToken: string | null;
    /** Repository that runs `verify-apk.yml`, as `owner/name`. */
    githubVerifyRepo: string | null;
    githubVerifyRef: string;
    /** Shared secret between the workflow callback and this server. */
    apkVerifierSecret: string | null;
    updateCheckEnabled: boolean;
    updateMaxApkBytes: number;
    updateFetchTimeoutMs: number;
    /** Repository that receives the static catalog JSON, as `owner/name`. */
    catalogJsonRepo: string | null;
    catalogJsonBranch: string;
    /** Repository directory for the JSON documents. */
    catalogJsonPath: string;
    /** Server-only token with Contents: write for the catalog repository. */
    catalogJsonToken: string | null;
  }>;

const secureOrLoopbackUrl = z.string().url().refine(value => {
  const url = new URL(value);
  const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

  return url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(url.hostname));
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: secureOrLoopbackUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
});

const optionalSecret = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(32).optional(),
);

const optionalText = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const positiveInteger = (fallback: number) =>
  z.preprocess(
    value => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z.number().int().positive(),
  ).default(fallback);

const serverSchema = publicSchema.extend({
  NEXT_PUBLIC_SITE_URL: secureOrLoopbackUrl,
  SUPABASE_SECRET_KEY: z.string().trim().min(1),
  ADMIN_READ_ONLY: z.enum(['true', 'false']).default('true'),
  AUTH_EMAIL_ENABLED: z.enum(['true', 'false']).default('false'),
  EXTERNAL_APK_PUBLISHING_ENABLED: z.enum(['true', 'false']).default('false'),
  CLEANUP_WORKER_SECRET: optionalSecret,
  CRON_SECRET: optionalSecret,
  GITHUB_TOKEN: optionalText,
  GITHUB_VERIFY_REPO: z
    .preprocess(
      value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
    ),
  GITHUB_VERIFY_REF: z.string().trim().min(1).default('main'),
  APK_VERIFIER_SECRET: optionalSecret,
  UPDATE_CHECK_ENABLED: z.enum(['true', 'false']).default('false'),
  UPDATE_MAX_APK_BYTES: positiveInteger(200_000_000),
  UPDATE_FETCH_TIMEOUT_MS: positiveInteger(15_000),
  CATALOG_JSON_REPO: z
    .preprocess(
      value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
    ),
  CATALOG_JSON_BRANCH: z.string().trim().min(1).default('main'),
  CATALOG_JSON_PATH: z
    .string()
    .trim()
    .refine(
      value =>
        value === '' ||
        (/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(value) &&
          value.split('/').every(segment => segment !== '.' && segment !== '..')),
      { message: 'Geçersiz klasör' },
    )
    .default('catalog'),
  CATALOG_JSON_GITHUB_TOKEN: optionalText,
});

function parseEnv<T>(schema: z.ZodType<T>, source: EnvSource): T {
  const result = schema.safeParse(source);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => String(issue.path[0] ?? 'environment')))]
      .sort()
      .join(', ');
    throw new Error(`Geçersiz ortam değişkeni: ${fields}`);
  }

  return result.data;
}

export function getPublicEnv(source: EnvSource = process.env): PublicEnv {
  const env = parseEnv(publicSchema, source);

  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getServerEnv(source: EnvSource = process.env): ServerEnv {
  const env = parseEnv(serverSchema, source);

  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY,
    adminReadOnly: env.ADMIN_READ_ONLY === 'true',
    authEmailEnabled: env.AUTH_EMAIL_ENABLED === 'true',
    externalApkPublishingEnabled: env.EXTERNAL_APK_PUBLISHING_ENABLED === 'true',
    cleanupWorkerSecret: env.CLEANUP_WORKER_SECRET ?? null,
    cronSecret: env.CRON_SECRET ?? null,
    githubToken: env.GITHUB_TOKEN ?? null,
    githubVerifyRepo: env.GITHUB_VERIFY_REPO ?? null,
    githubVerifyRef: env.GITHUB_VERIFY_REF,
    apkVerifierSecret: env.APK_VERIFIER_SECRET ?? null,
    updateCheckEnabled: env.UPDATE_CHECK_ENABLED === 'true',
    updateMaxApkBytes: env.UPDATE_MAX_APK_BYTES,
    updateFetchTimeoutMs: env.UPDATE_FETCH_TIMEOUT_MS,
    catalogJsonRepo: env.CATALOG_JSON_REPO ?? null,
    catalogJsonBranch: env.CATALOG_JSON_BRANCH,
    catalogJsonPath: env.CATALOG_JSON_PATH,
    catalogJsonToken: env.CATALOG_JSON_GITHUB_TOKEN ?? null,
  };
}
