import { type Href, useLocalSearchParams, useRouter } from 'expo-router';

import { ConfirmEmailScreen } from '../../src/features/auth/ConfirmEmailScreen';

export default function ConfirmEmailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const email = Array.isArray(params.email) ? (params.email[0] ?? '') : (params.email ?? '');

  return (
    <ConfirmEmailScreen
      email={email}
      onContinue={() => router.replace('/(tabs)/account' as Href)}
    />
  );
}
