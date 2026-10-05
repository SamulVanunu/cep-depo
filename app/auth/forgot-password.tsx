import { type Href, useRouter } from 'expo-router';

import { ForgotPasswordScreen } from '../../src/features/auth/ForgotPasswordScreen';

export default function ForgotPasswordRoute() {
  const router = useRouter();
  return <ForgotPasswordScreen onBack={() => router.replace('/auth/sign-in' as Href)} />;
}
