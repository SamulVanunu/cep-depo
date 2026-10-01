import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AppProviders } from '../src/providers/AppProviders';
import { ConfigurationErrorScreen } from '../src/components/ui/ConfigurationErrorScreen';
import { BootstrapGate } from '../src/features/bootstrap/BootstrapGate';
import { getPublicEnv } from '../src/lib/env';
import { getSupabaseClient } from '../src/lib/supabase';

async function prepareStartup() {
  await getSupabaseClient().auth.getSession();
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
