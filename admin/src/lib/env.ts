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

const serverSchema = publicSchema.extend({
  NEXT_PUBLIC_SITE_URL: secureOrLoopbackUrl,
  SUPABASE_SECRET_KEY: z.string().trim().min(1),
  ADMIN_READ_ONLY: z.enum(['true', 'false']).default('true'),
  AUTH_EMAIL_ENABLED: z.enum(['true', 'false']).default('false'),
  EXTERNAL_APK_PUBLISHING_ENABLED: z.enum(['true', 'false']).default('false'),
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
  };
}
