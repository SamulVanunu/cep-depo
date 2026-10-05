import * as Linking from 'expo-linking';
import { type Href, Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';

import { AppProviders } from '../src/providers/AppProviders';
import { ConfigurationErrorScreen } from '../src/components/ui/ConfigurationErrorScreen';
import { BootstrapGate } from '../src/features/bootstrap/BootstrapGate';
import { handleAuthCallback } from '../src/features/auth/auth-links';
import { getPublicEnv } from '../src/lib/env';
import { getSupabaseClient } from '../src/lib/supabase';

async function prepareStartup() {
  // AuthProvider owns session loading while the bootstrap animation is visible.
}

const authRoutes = {
  confirmed: '/auth/confirm' as Href,
  recovery: '/auth/reset-password' as Href,
};

function AuthLinkHandler() {
  const router = useRouter();
  const handledUrls = useRef(new Set<string>());

  useEffect(() => {
    let mounted = true;

    const handleUrl = async (url: string | null) => {
      if (!url || handledUrls.current.has(url)) return;
      handledUrls.current.add(url);

      try {
        const result = await handleAuthCallback(url, getSupabaseClient());
        if (mounted && result !== 'ignored') router.replace(authRoutes[result]);
      } catch {
        // Auth screens added by the account flow show the generic recovery state.
      }
    };

    void Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const subscription = Linking.addEventListener('url', event => void handleUrl(event.url));

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [router]);

  return null;
}

export default function RootLayout() {
  try {
    getPublicEnv();
  } catch {
    return <ConfigurationErrorScreen />;
  }

  return (
    <AppProviders>
      <BootstrapGate startup={prepareStartup}>
        <AuthLinkHandler />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: '#111315' },
            headerShown: false,
          }}
        />
      </BootstrapGate>
    </AppProviders>
  );
}
