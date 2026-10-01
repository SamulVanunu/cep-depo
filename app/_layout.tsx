import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AppProviders } from '../src/app/AppProviders';
import { ConfigurationErrorScreen } from '../src/components/ui/ConfigurationErrorScreen';
import { getPublicEnv } from '../src/lib/env';

export default function RootLayout() {
  try {
    getPublicEnv();
  } catch {
    return <ConfigurationErrorScreen />;
  }

  return (
    <AppProviders>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#111315' },
          headerShown: false,
        }}
      />
    </AppProviders>
  );
}
