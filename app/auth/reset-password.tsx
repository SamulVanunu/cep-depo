import { type Href, useRouter } from 'expo-router';

import { ResetPasswordScreen } from '../../src/features/auth/ResetPasswordScreen';

export default function ResetPasswordRoute() {
  const router = useRouter();
  return (
    <ResetPasswordScreen onComplete={() => router.replace('/(tabs)/account' as Href)} />
  );
}
