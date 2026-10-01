export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const CONFIGURATION_ERROR = 'Supabase yapılandırması eksik veya geçersiz.';

function defaultEnvironment(): EnvironmentSource {
  return {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getPublicEnv(source: EnvironmentSource = defaultEnvironment()): PublicEnv {
  const rawUrl = source.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = source.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!rawUrl || !publishableKey) {
    throw new Error(CONFIGURATION_ERROR);
  }

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || !url.hostname) {
      throw new Error(CONFIGURATION_ERROR);
    }

    return {
      supabaseUrl: url.toString().replace(/\/$/, ''),
      supabasePublishableKey: publishableKey,
    };
  } catch {
    throw new Error(CONFIGURATION_ERROR);
  }
}
